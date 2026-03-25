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
import { extractPdfText, type ParsedLine } from "@/lib/pdf/extract-text";
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

  // Collect all candidate matches with scores, then pick the best one.
  // This avoids returning the first "contains" match when a better one exists later.
  let bestMatch: { value: number; confidence: number; lengthDiff: number } | null = null;

  for (const table of section.tables) {
    for (const row of table.rows) {
      const rowLabel = row.label.toLowerCase().trim();
      const lastValue = [...row.values].reverse().find((v) => v !== null);
      if (lastValue === null || lastValue === undefined) continue;

      let confidence = 0;
      const lengthDiff = Math.abs(rowLabel.length - normalizedLabel.length);

      if (rowLabel === normalizedLabel) {
        // Exact match — return immediately
        return { value: lastValue, confidence: 1.0 };
      } else if (rowLabel.includes(normalizedLabel) || normalizedLabel.includes(rowLabel)) {
        // Contains match — prefer the one with the smallest length difference
        // (i.e., "Total pasivos" is a better match for "Total de pasivos" than
        // "Total de pasivos circulantes distintos de los pasivos atribuibles...")
        confidence = 0.85;
      }

      if (confidence > 0) {
        if (!bestMatch || lengthDiff < bestMatch.lengthDiff) {
          bestMatch = { value: lastValue, confidence, lengthDiff };
        }
      }
    }
  }

  return bestMatch ? { value: bestMatch.value, confidence: bestMatch.confidence } : null;
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
 * Get the value at a specific column index from an IFRS data line,
 * skipping small positive integers that are note references.
 *
 * @param values - All numeric values extracted from the line
 * @param colIndex - Target column index among "real" values (after filtering notes).
 *                   0 = first real value, 2 = third, etc.
 */
function getRealValueAtIndex(values: number[], colIndex: number): number | null {
  // Filter out note references: small numbers 0-99 (including decimals like 27.6)
  // In MUS$ statements, real financial values are always >= 100
  const realValues = values.filter((v) => Math.abs(v) >= 100);
  return realValues[colIndex] ?? null;
}

/**
 * Match a label against extracted text lines from an IFRS PDF.
 *
 * @param colIndex - Which column to extract (0-based among real values).
 * @param pageRange - Optional [min, max] page range to restrict search.
 *   Income statement items should only search income statement pages.
 *   Balance sheet items should only search balance sheet pages.
 */
function findValueInText(
  lines: ParsedLine[],
  sourceLabel: string,
  colIndex: number = 0,
  pageRange?: [number, number]
): { value: number; confidence: number } | null {
  const normalized = sourceLabel.toLowerCase().trim();

  // Filter by page range if specified
  const filtered = pageRange
    ? lines.filter((l) => l.page >= pageRange[0] && l.page <= pageRange[1])
    : lines;

  function tryMatch(
    line: ParsedLine,
    confidence: number
  ): { value: number; confidence: number } | null {
    const val = getRealValueAtIndex(line.values, colIndex);
    if (val !== null) return { value: val, confidence };
    const fallback = getRealValueAtIndex(line.values, 0);
    if (fallback !== null) return { value: fallback, confidence: confidence * 0.7 };
    return null;
  }

  // Pass 1: exact match
  for (const line of filtered) {
    const stripped = stripNoteRef(line.label).toLowerCase().trim();
    if (stripped === normalized) {
      const result = tryMatch(line, 1.0);
      if (result) return result;
    }
  }

  // Pass 2: starts-with match — prefer the LONGER label (more specific)
  let bestStartsWith: { line: ParsedLine; overlap: number } | null = null;
  for (const line of filtered) {
    const stripped = stripNoteRef(line.label).toLowerCase().trim();
    if (stripped.startsWith(normalized) || normalized.startsWith(stripped)) {
      const overlap = Math.min(stripped.length, normalized.length);
      if (overlap >= 10 && (!bestStartsWith || stripped.length > bestStartsWith.overlap)) {
        bestStartsWith = { line, overlap: stripped.length };
      }
    }
  }
  if (bestStartsWith) {
    const result = tryMatch(bestStartsWith.line, 0.9);
    if (result) return result;
  }

  // Pass 3: contains match
  for (const line of filtered) {
    const stripped = stripNoteRef(line.label).toLowerCase().trim();
    if (stripped.includes(normalized) || normalized.includes(stripped)) {
      const result = tryMatch(line, 0.75);
      if (result) return result;
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
  let textLines: ParsedLine[] = [];

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

    // For IFRS text extraction:
    // sourceCol specifies column index and page range:
    //   "q"  = quarterly standalone (col 2 of 4), income statement pages (6-7)
    //   "bs" = balance sheet current (col 0 of 3), balance sheet pages (4-5)
    //   "cf" = cash flow current (col 0 of 2), cash flow pages (9-10)
    const colIndex = mapping.sourceCol === "q" ? 2
      : mapping.sourceCol === "bs" ? 0
      : mapping.sourceCol === "cf" ? 0
      : 0;

    // Page ranges for IFRS filing structure
    // Ranges are generous to handle PDF renderers that shift page boundaries
    const pageRange: [number, number] | undefined =
      mapping.sourceCol === "q" ? [5, 8]     // income statement (usually pages 6-7)
      : mapping.sourceCol === "bs" ? [3, 6]   // balance sheet (usually pages 4-5)
      : mapping.sourceCol === "cf" ? [8, 12]  // cash flow (usually pages 9-10)
      : undefined;

    const match = isIfrsText
      ? findValueInText(textLines, mapping.sourceLabel, colIndex, pageRange)
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
