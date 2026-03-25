/**
 * Extraction pipeline — downloads source file, extracts financial data using
 * pdfplumber (PDF) or exceljs (Excel), applies field mappings + transforms,
 * validates, and saves extracted values to the database.
 *
 * Supports two PDF formats:
 *   - BIVA-style (Mexican filings with section codes like [310000])
 *   - IFRS-style (Chilean/generic filings with text-pattern matching)
 */
import { getDb } from "@/db";
import { fieldMappings, extractionRuns, extractedValues } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractPdfTables, type PdfSection } from "@/lib/pdf/extract";
import { extractPdfText } from "@/lib/pdf/extract-text";
import { runValidation, type ValidationInput } from "@/lib/validation/engine";

// ── Value transforms ────────────────────────────────────────────────────────

function applyTransform(
  rawValue: number,
  transform: string | null
): number {
  switch (transform) {
    case "divide_1000000":
      return rawValue / 1_000_000;
    case "negate_divide_1000000":
      return -Math.abs(rawValue) / 1_000_000;
    case "negate":
      return -Math.abs(rawValue);
    case "divide_1000":
      return rawValue / 1_000;
    case "negate_divide_1000":
      return -Math.abs(rawValue) / 1_000;
    default:
      return rawValue;
  }
}

// ── Label matching (BIVA sections) ──────────────────────────────────────────

/**
 * Fuzzy-match a mapping's sourceLabel against PDF table row labels.
 * Returns the best match's raw value, or null if no match.
 */
function findValueInSection(
  sections: PdfSection[],
  sectionCode: string,
  sourceLabel: string
): { value: number; confidence: number } | null {
  const section = sections.find((s) => s.code === sectionCode);
  if (!section) return null;

  const normalizedLabel = sourceLabel.toLowerCase().trim();

  for (const table of section.tables) {
    for (const row of table.rows) {
      const rowLabel = row.label.toLowerCase().trim();

      // Exact match
      if (rowLabel === normalizedLabel) {
        const lastValue = [...row.values].reverse().find((v) => v !== null);
        if (lastValue !== null && lastValue !== undefined) {
          return { value: lastValue, confidence: 1.0 };
        }
      }

      // Contains match
      if (rowLabel.includes(normalizedLabel) || normalizedLabel.includes(rowLabel)) {
        const lastValue = [...row.values].reverse().find((v) => v !== null);
        if (lastValue !== null && lastValue !== undefined) {
          return { value: lastValue, confidence: 0.85 };
        }
      }
    }
  }

  return null;
}

// ── Label matching (IFRS text) ──────────────────────────────────────────────

/**
 * Strip IFRS note references from a label.
 * e.g., "Ingresos de actividades ordinarias 28" → "Ingresos de actividades ordinarias"
 * e.g., "Efectivo y equivalentes al efectivo 6" → "Efectivo y equivalentes al efectivo"
 * Also strips [Subtotal] tags.
 */
function stripNoteRef(label: string): string {
  return label
    .replace(/\s+\d{1,3}(\.\d)?$/, "") // trailing note numbers like " 28" or " 27.6"
    .replace(/\s*\[Subtotal\]/gi, "")   // [Subtotal] tags
    .trim();
}

/**
 * Get the first "real" value from an IFRS data line, skipping small numbers
 * that are likely note references (e.g., "28", "33", "6").
 * Real financial values in MUS$ are typically > 100.
 */
function getFirstRealValue(values: number[]): number | null {
  for (const v of values) {
    // Skip small positive integers that look like note references
    if (Number.isInteger(v) && v > 0 && v < 100) continue;
    return v;
  }
  // If all values were small, return the first one (it might be legitimate)
  return values[0] ?? null;
}

/**
 * Match a label against extracted text lines from an IFRS PDF.
 * Returns the first real numeric value found on the matching line.
 */
function findValueInText(
  lines: { label: string; values: number[] }[],
  sourceLabel: string
): { value: number; confidence: number } | null {
  const normalized = sourceLabel.toLowerCase().trim();

  // Pass 1: exact match (after stripping note refs and [Subtotal])
  for (const line of lines) {
    const stripped = stripNoteRef(line.label).toLowerCase().trim();
    if (stripped === normalized) {
      const val = getFirstRealValue(line.values);
      if (val !== null) {
        return { value: val, confidence: 1.0 };
      }
    }
  }

  // Pass 2: starts-with match (prefer more specific)
  for (const line of lines) {
    const stripped = stripNoteRef(line.label).toLowerCase().trim();
    if (stripped.startsWith(normalized) || normalized.startsWith(stripped)) {
      // Require reasonable length overlap to avoid false positives
      const overlap = Math.min(stripped.length, normalized.length);
      if (overlap >= 10) {
        const val = getFirstRealValue(line.values);
        if (val !== null) {
          return { value: val, confidence: 0.9 };
        }
      }
    }
  }

  // Pass 3: contains match (least confident)
  for (const line of lines) {
    const stripped = stripNoteRef(line.label).toLowerCase().trim();
    if (stripped.includes(normalized) || normalized.includes(stripped)) {
      const val = getFirstRealValue(line.values);
      if (val !== null) {
        return { value: val, confidence: 0.75 };
      }
    }
  }

  return null;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export async function runExtractionPipeline(runId: number): Promise<{
  extracted: number;
  validated: number;
  errors: string[];
}> {
  const db = getDb();
  const errors: string[] = [];

  // 1. Fetch run details
  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.id, runId));

  if (!run) throw new Error(`Run ${runId} not found`);
  if (!run.sourceFileUrl) throw new Error(`Run ${runId} has no source file URL`);
  if (!run.companyId) throw new Error(`Run ${runId} has no company ID`);

  // 2. Fetch active mappings for this company
  const mappings = await db
    .select()
    .from(fieldMappings)
    .where(
      and(
        eq(fieldMappings.companyId, run.companyId),
        eq(fieldMappings.isActive, true)
      )
    );

  if (mappings.length === 0) {
    throw new Error(`No active mappings for company ${run.companyId}`);
  }

  // 3. Download source file
  const response = await fetch(run.sourceFileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download source file: ${response.statusText}`);
  }
  const fileBuffer = Buffer.from(await response.arrayBuffer());

  // 4. Determine file type and extract
  const isPdf =
    run.sourceFileUrl.toLowerCase().endsWith(".pdf") ||
    fileBuffer[0] === 0x25; // %PDF magic byte

  if (!isPdf) {
    throw new Error("Excel source extraction not yet implemented — use PDF source files");
  }

  // Determine extraction mode from mappings
  const sectionCodes = [
    ...new Set(mappings.map((m) => m.sourceSection).filter(Boolean)),
  ] as string[];
  const isIfrsText = sectionCodes.includes("ifrs_text");

  // Extract data using appropriate method
  let sections: PdfSection[] = [];
  let textLines: { label: string; values: number[] }[] = [];

  if (isIfrsText) {
    textLines = await extractPdfText(fileBuffer);
    if (textLines.length === 0) {
      throw new Error("IFRS PDF text extraction returned no data lines");
    }
  } else {
    sections = await extractPdfTables(fileBuffer, sectionCodes);
    if (sections.length === 0) {
      throw new Error("PDF extraction returned no sections");
    }
  }

  // 5. Match mappings to extracted data and apply transforms
  const valuesToInsert: {
    runId: number;
    mappingId: number;
    extractedValue: string;
    confidence: number;
  }[] = [];

  for (const mapping of mappings) {
    if (!mapping.sourceSection) {
      errors.push(`Mapping ${mapping.id} (${mapping.sourceLabel}) has no source section`);
      continue;
    }

    const match = isIfrsText
      ? findValueInText(textLines, mapping.sourceLabel)
      : findValueInSection(sections, mapping.sourceSection, mapping.sourceLabel);

    if (!match) {
      errors.push(
        `No match for "${mapping.sourceLabel}" in ${isIfrsText ? "IFRS text" : "section " + mapping.sourceSection}`
      );
      continue;
    }

    const transformed = applyTransform(match.value, mapping.valueTransform);

    valuesToInsert.push({
      runId,
      mappingId: mapping.id,
      extractedValue: transformed.toFixed(6),
      confidence: match.confidence,
    });
  }

  if (valuesToInsert.length === 0) {
    throw new Error("Extraction matched zero values — check mappings and source file");
  }

  // 6. Save extracted values to DB
  const inserted = await db
    .insert(extractedValues)
    .values(valuesToInsert)
    .returning();

  // 7. Run validation
  const validationInputs: ValidationInput[] = inserted.map((v) => {
    const mapping = mappings.find((m) => m.id === v.mappingId)!;
    return {
      id: v.id,
      extractedValue: v.extractedValue!,
      confidence: v.confidence ?? 1.0,
      validationSign: mapping.validationSign,
      sourceLabel: mapping.sourceLabel,
    };
  });

  const validationResults = runValidation(validationInputs);

  // 8. Update values with validation results
  for (const result of validationResults) {
    await db
      .update(extractedValues)
      .set({
        validationStatus: result.status,
        validationMessage: result.message,
      })
      .where(eq(extractedValues.id, result.id));
  }

  // 9. Update run status
  await db
    .update(extractionRuns)
    .set({ status: "extracted", extractedAt: new Date() })
    .where(eq(extractionRuns.id, runId));

  return {
    extracted: inserted.length,
    validated: validationResults.filter((r) => r.status === "pass").length,
    errors,
  };
}
