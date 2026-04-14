/**
 * Extraction pipeline — downloads source file, extracts financial data using
 * pdfplumber (PDF) or exceljs (Excel), applies field mappings + transforms,
 * validates, and saves extracted values to the database.
 *
 * Supports three PDF extraction modes:
 *   - BIVA-style (Mexican filings with section codes like [310000])
 *   - IFRS-style (Chilean/generic filings with text-pattern matching)
 *   - Vision-based (image-heavy PDFs → render pages → Claude vision OCR)
 */
import { getDb } from "@/db";
import { fieldMappings, extractionRuns, extractedValues } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractPdfTables, type PdfSection } from "@/lib/pdf/extract";
import { extractPdfText, type ParsedLine } from "@/lib/pdf/extract-text";
import { extractPdfVision } from "@/lib/pdf/extract-vision";
import {
  runValidation,
  runAdversarialValidation,
  shouldTriggerAdversarial,
  type ValidationInput,
  type ExtractedValueForValidation,
  type AdversarialResult,
} from "@/lib/validation/engine";

// ── Extraction result type ──────────────────────────────────────────────────

export interface ExtractionResult {
  extracted: number;
  validated: number;
  errors: string[];
  /** Whether adversarial validation was triggered (warnings existed) */
  adversarialTriggered?: boolean;
  /** Result of adversarial validation if triggered */
  adversarialResult?: AdversarialResult["status"];
}

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

// ── Adversarial validation helper ───────────────────────────────────────────

/**
 * Run adversarial validation on extracted values if warnings exist.
 * Updates validation status in DB if adversarial validation changes the outcome.
 *
 * @param db - Database instance
 * @param values - Extracted values with basic validation results
 * @param mappings - Field mappings for context
 * @returns Adversarial validation result or null if not triggered
 */
async function maybeRunAdversarialValidation(
  db: ReturnType<typeof getDb>,
  values: { id: number; extractedValue: string | null; confidence: number | null; mappingId: number | null }[],
  mappings: { id: number; sourceLabel: string; targetSheet: string }[],
  basicResults: { id: number; status: "pass" | "warning" | "fail"; message: string | null }[]
): Promise<{ triggered: boolean; result?: Awaited<ReturnType<typeof runAdversarialValidation>> }> {
  // Filter out values without mappings
  const validValues = values.filter(v => v.mappingId !== null);
  if (validValues.length === 0) return { triggered: false };

  // Build values for adversarial check
  const adversarialInputs: ExtractedValueForValidation[] = validValues.map(v => {
    const mapping = mappings.find(m => m.id === v.mappingId)!;
    const basicResult = basicResults.find(r => r.id === v.id);
    return {
      id: v.id,
      sourceLabel: mapping.sourceLabel,
      extractedValue: v.extractedValue ?? "0",
      confidence: v.confidence ?? 1.0,
      validationStatus: basicResult?.status ?? null,
      validationMessage: basicResult?.message ?? null,
    };
  });

  // Determine statement type from target sheet so the gate can run
  // constraint checks against the right constraint set.
  const targetSheet = mappings[0]?.targetSheet?.toLowerCase() ?? "";
  const statementType: "income" | "balance" | "cashflow" =
    targetSheet.includes("is") || targetSheet.includes("income") ? "income" :
    targetSheet.includes("bs") || targetSheet.includes("balance") ? "balance" :
    "income"; // default to income statement constraints

  // Check if adversarial validation should run (now includes rule-based
  // constraint violations, not just warnings/low-confidence).
  if (!shouldTriggerAdversarial(adversarialInputs, statementType)) {
    return { triggered: false };
  }

  // Run adversarial validation
  const result = await runAdversarialValidation(adversarialInputs, statementType);

  // If adversarial validation says needs_review, update status in DB
  if (result.status === "needs_review") {
    for (const v of adversarialInputs) {
      const basicResult = basicResults.find(r => r.id === v.id);
      // Only upgrade warnings to needs_review, don't downgrade passes
      if (basicResult?.status === "warning") {
        await db
          .update(extractedValues)
          .set({
            validationStatus: "needs_review",
            validationMessage: `${basicResult.message} | Adversarial: ${result.message}`,
          })
          .where(eq(extractedValues.id, v.id));
      }
    }
  }

  return { triggered: true, result };
}

// ── BIVA column detection ──────────────────────────────────────────────────

/**
 * BIVA PDFs have standardized column headers. We detect the correct column
 * automatically from the headers rather than relying on hardcoded indices.
 *
 * Preference order (first match wins):
 *   1. "Trimestre.*Actual"  — quarterly current period (Income Statement, Cash Flow)
 *   2. "Cierre Trimestre.*Actual" — current quarter close (Balance Sheet)
 *   3. "Acumulado.*Actual"  — year-to-date current (fallback for IS/CF)
 *   4. Column 0             — absolute fallback (first data column = current period)
 *
 * This works for any BIVA company without per-mapping configuration.
 */
const BIVA_PREFERRED_HEADERS = [
  /trimestre\s*(a[ñn]o\s*)?actual/i,  // quarterly current
  /cierre\s*trimestre\s*actual/i,       // balance sheet current close
  /acumulado\s*(a[ñn]o\s*)?actual/i,   // YTD current
];

function detectBivaColIndex(headers: string[]): number {
  // Skip first header (always "Concepto")
  for (const pattern of BIVA_PREFERRED_HEADERS) {
    for (let i = 1; i < headers.length; i++) {
      if (pattern.test(headers[i])) {
        return i - 1; // -1 because row.values doesn't include the label column
      }
    }
  }
  return 0; // fallback: first data column
}

// ── Label matching (BIVA sections) ──────────────────────────────────────────

/**
 * Fuzzy-match a mapping's sourceLabel against PDF table row labels.
 *
 * Column selection (in priority order):
 *   1. Explicit colOverride (for vision extraction where column is known)
 *   2. Auto-detect from BIVA table headers (for BIVA filings)
 *   3. Fallback to column 0 (first data column)
 */
function findValueInSection(
  sections: PdfSection[],
  sectionCode: string,
  sourceLabel: string,
  colOverride: number | null = null
): { value: number; confidence: number } | null {
  const section = sections.find((s) => s.code === sectionCode);
  if (!section) return null;

  const normalizedLabel = sourceLabel.toLowerCase().trim();

  let bestMatch: { value: number; confidence: number; lengthDiff: number } | null = null;

  for (const table of section.tables) {
    // Use explicit column if provided, otherwise auto-detect from headers
    const colIndex = colOverride ?? detectBivaColIndex(table.headers);

    for (const row of table.rows) {
      const rowLabel = row.label.toLowerCase().trim();
      const targetValue =
        colIndex >= 0 && colIndex < row.values.length
          ? row.values[colIndex]
          : row.values.find((v) => v !== null) ?? null;
      if (targetValue === null || targetValue === undefined) continue;

      let confidence = 0;
      const lengthDiff = Math.abs(rowLabel.length - normalizedLabel.length);

      if (rowLabel === normalizedLabel) {
        return { value: targetValue, confidence: 1.0 };
      } else if (rowLabel.includes(normalizedLabel) || normalizedLabel.includes(rowLabel)) {
        confidence = 0.85;
      }

      if (confidence > 0) {
        if (!bestMatch || lengthDiff < bestMatch.lengthDiff) {
          bestMatch = { value: targetValue, confidence, lengthDiff };
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

// ── Excel source extraction (Python fallback for large files) ──────────────

/**
 * Python-based Excel extraction using openpyxl. Handles large files that crash ExcelJS.
 */
async function extractFromExcelPython(
  fileBuffer: Buffer,
  mappings: typeof fieldMappings.$inferSelect[],
  runId: number,
  errors: string[]
): Promise<ExtractionResult> {
  const { spawn } = await import("child_process");
  const { writeFile, unlink } = await import("fs/promises");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const { randomUUID } = await import("crypto");

  const tmpPath = join(tmpdir(), `excel-extract-${randomUUID()}.xlsx`);
  await writeFile(tmpPath, fileBuffer);
  const db = getDb();

  try {
    // Group mappings by sheet+column
    const groups = new Map<string, typeof mappings>();
    for (const m of mappings) {
      if (!m.sourceSection || !m.sourceCol) continue;
      const key = `${m.sourceSection}::${m.sourceCol}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    const valuesToInsert: {
      runId: number;
      mappingId: number;
      extractedValue: string;
      confidence: number;
    }[] = [];

    for (const [key, groupMappings] of groups) {
      const [sheetName, targetHeader] = key.split("::");

      // Run Python extractor (remote API or local subprocess)
      let result: string;
      if (process.env.EXTRACTION_API_URL) {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(fileBuffer)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }), "input.xlsx");
        form.append("sheet_name", sheetName);
        form.append("target_header", targetHeader);
        form.append("label_cols", "0,1,2");
        const res = await fetch(`${process.env.EXTRACTION_API_URL}/extract/excel`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(`Remote Excel extraction failed: ${err.detail || err.error}`);
        }
        result = JSON.stringify(await res.json());
      } else {
        result = await new Promise<string>((resolve, reject) => {
          const scriptPath = join(process.cwd(), "src/lib/pdf/extract-excel.py");
          const proc = spawn("python3", [scriptPath, tmpPath, sheetName, targetHeader, "0,1,2"]);
          let stdout = "";
          let stderr = "";
          proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
          proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
          proc.on("close", (code: number | null) => {
            if (code !== 0) reject(new Error(`Python Excel extraction failed: ${stderr}`));
            else resolve(stdout.trim());
          });
        });
      }

      const parsed = JSON.parse(result) as {
        error?: string;
        data?: Record<string, number>;
        row_data?: Record<string, number>;
      };
      if (parsed.error) {
        errors.push(parsed.error);
        continue;
      }

      const labelMap = parsed.data ?? {};
      const rowMap = parsed.row_data ?? {};

      for (const mapping of groupMappings) {
        let value: number | null = null;

        // Prefer row-based lookup when sourceRow is specified (disambiguates duplicate labels)
        if (mapping.sourceRow && rowMap[String(mapping.sourceRow)] !== undefined) {
          value = rowMap[String(mapping.sourceRow)];
        }

        // Fall back to label matching
        if (value === null) {
          const normalized = mapping.sourceLabel.toLowerCase().trim();
          value = labelMap[normalized] ?? null;

          // Fuzzy match fallback
          if (value === null) {
            let bestDiff = Infinity;
            for (const [k, v] of Object.entries(labelMap)) {
              if (k.includes(normalized) || normalized.includes(k)) {
                const diff = Math.abs(k.length - normalized.length);
                if (diff < bestDiff) { bestDiff = diff; value = v; }
              }
            }
          }
        }

        if (value === null) {
          errors.push(`No match for "${mapping.sourceLabel}" in ${sheetName}::${targetHeader}`);
          continue;
        }

        const transformed = applyTransform(value, mapping.valueTransform);
        valuesToInsert.push({
          runId,
          mappingId: mapping.id,
          extractedValue: transformed.toFixed(6),
          confidence: 1.0,
        });
      }
    }

    if (valuesToInsert.length === 0) {
      throw new Error("Excel extraction matched zero values — check mappings and source file");
    }

    const inserted = await db.insert(extractedValues).values(valuesToInsert).returning();

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
    for (const vr of validationResults) {
      await db
        .update(extractedValues)
        .set({ validationStatus: vr.status, validationMessage: vr.message })
        .where(eq(extractedValues.id, vr.id));
    }

    // Run adversarial validation if warnings exist (autoreason-style debate)
    const adversarialCheck = await maybeRunAdversarialValidation(
      db,
      inserted,
      mappings,
      validationResults
    );

    await db
      .update(extractionRuns)
      .set({ status: "extracted", extractedAt: new Date() })
      .where(eq(extractionRuns.id, runId));

    return {
      extracted: inserted.length,
      validated: validationResults.filter((r) => r.status === "pass").length,
      adversarialTriggered: adversarialCheck.triggered,
      adversarialResult: adversarialCheck.result?.status,
      errors,
    };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

// ── Excel source extraction (ExcelJS) ─────────────────────────────────────

/**
 * Extract financial data from a source Excel spreadsheet.
 *
 * Mapping convention for Excel sources:
 *   - sourceSection: sheet name in the source workbook (e.g., "Income Statement")
 *   - sourceLabel: row label to fuzzy-match (checks columns B and C for EN/PT labels)
 *   - sourceCol: column header to find (e.g., "4Q25") — scanned in row 6
 */
async function extractFromExcel(
  fileBuffer: Buffer,
  mappings: typeof fieldMappings.$inferSelect[],
  runId: number,
  _companyId: number,
  errors: string[]
): Promise<ExtractionResult> {
  // Files >2MB crash ExcelJS with OOM — use Python (openpyxl) for large files.
  // ExcelJS inflates xlsx into in-memory DOM; complex workbooks blow up the heap.
  const MAX_EXCELJS_SIZE = 2 * 1024 * 1024; // 2MB
  if (fileBuffer.length > MAX_EXCELJS_SIZE || process.env.VERCEL) {
    return extractFromExcelPython(fileBuffer, mappings, runId, errors);
  }

  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.default.Workbook();
  await wb.xlsx.read(
    new (await import("stream")).PassThrough().end(fileBuffer) as never
  );

  const db = getDb();

  // Build a cache of sheet data: { sheetName → { label → value } }
  const sheetCache = new Map<string, Map<string, number>>();

  for (const mapping of mappings) {
    if (!mapping.sourceSection || !mapping.sourceCol) continue;

    const sheetName = mapping.sourceSection;
    const targetHeader = mapping.sourceCol; // e.g., "4Q25"

    // Get or build cache for this sheet+column combo
    const cacheKey = `${sheetName}::${targetHeader}`;
    if (!sheetCache.has(cacheKey)) {
      const ws = wb!.getWorksheet(sheetName);
      if (!ws) {
        errors.push(`Sheet "${sheetName}" not found in source Excel`);
        sheetCache.set(cacheKey, new Map());
        continue;
      }

      // Find the column with the target header.
      // Supports string match (e.g., "4Q25") and date match (e.g., "4Q25" → Dec 2025).
      // Scans rows 6, 4, 2 for period labels (different source files use different rows).
      let dataCol: number | null = null;
      for (const scanRow of [6, 4, 2]) {
        for (let c = 1; c <= ws.columnCount; c++) {
          const v = ws.getCell(scanRow, c).value;
          const display = v && typeof v === "object" && "result" in v ? v.result : v;
          if (display == null) continue;

          // String match
          if (String(display).trim() === targetHeader) {
            dataCol = c;
            break;
          }

          // Date match: convert "4Q25" → Q4 2025 → check if date is in Oct-Dec 2025
          if (display instanceof Date && /^\d[Qq]\d{2}$/.test(targetHeader)) {
            const q = parseInt(targetHeader[0], 10);
            const yr = 2000 + parseInt(targetHeader.slice(2), 10);
            const month = display.getMonth(); // 0-indexed
            const year = display.getFullYear();
            const quarterOfDate = Math.floor(month / 3) + 1;
            if (year === yr && quarterOfDate === q) {
              dataCol = c;
              break;
            }
          }
        }
        if (dataCol) break;
      }

      if (!dataCol) {
        errors.push(`Column "${targetHeader}" not found in sheet "${sheetName}"`);
        sheetCache.set(cacheKey, new Map());
        continue;
      }

      // Build label→value map (check columns B=2 and C=3 for EN/PT labels)
      const labelMap = new Map<string, number>();
      for (let r = 3; r <= ws.rowCount; r++) {
        const labelB = ws.getCell(r, 2).value;
        const labelC = ws.getCell(r, 3).value;
        const raw = ws.getCell(r, dataCol).value;
        const val = raw && typeof raw === "object" && "result" in raw ? raw.result : raw;
        if (val == null || typeof val !== "number") continue;

        // Index by both EN (col B) and PT (col C) labels, lowercased
        if (labelB) labelMap.set(String(labelB).toLowerCase().trim(), val);
        if (labelC) labelMap.set(String(labelC).toLowerCase().trim(), val);
      }
      sheetCache.set(cacheKey, labelMap);
    }
  }

  // Match mappings to cached data
  const valuesToInsert: {
    runId: number;
    mappingId: number;
    extractedValue: string;
    confidence: number;
  }[] = [];

  for (const mapping of mappings) {
    if (!mapping.sourceSection || !mapping.sourceCol) {
      errors.push(`Mapping ${mapping.id} (${mapping.sourceLabel}) missing sourceSection or sourceCol`);
      continue;
    }

    const cacheKey = `${mapping.sourceSection}::${mapping.sourceCol}`;
    const labelMap = sheetCache.get(cacheKey);
    if (!labelMap || labelMap.size === 0) continue;

    const normalized = mapping.sourceLabel.toLowerCase().trim();

    // Try exact match first, then contains match
    let value: number | null = labelMap.get(normalized) ?? null;
    if (value === null) {
      // Contains match — find the entry with the smallest length difference
      let bestDiff = Infinity;
      for (const [key, val] of labelMap) {
        if (key.includes(normalized) || normalized.includes(key)) {
          const diff = Math.abs(key.length - normalized.length);
          if (diff < bestDiff) {
            bestDiff = diff;
            value = val;
          }
        }
      }
    }

    if (value === null) {
      errors.push(`No match for "${mapping.sourceLabel}" in ${mapping.sourceSection}::${mapping.sourceCol}`);
      continue;
    }

    const transformed = applyTransform(value, mapping.valueTransform);
    valuesToInsert.push({
      runId,
      mappingId: mapping.id,
      extractedValue: transformed.toFixed(6),
      confidence: 1.0, // Excel values are exact
    });
  }

  if (valuesToInsert.length === 0) {
    throw new Error("Excel extraction matched zero values — check mappings and source file");
  }

  // Save + validate (same as PDF path)
  const inserted = await db.insert(extractedValues).values(valuesToInsert).returning();

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
  for (const result of validationResults) {
    await db
      .update(extractedValues)
      .set({ validationStatus: result.status, validationMessage: result.message })
      .where(eq(extractedValues.id, result.id));
  }

  // Run adversarial validation if warnings exist (autoreason-style debate)
  const adversarialCheck = await maybeRunAdversarialValidation(
    db,
    inserted,
    mappings,
    validationResults
  );

  await db
    .update(extractionRuns)
    .set({ status: "extracted", extractedAt: new Date() })
    .where(eq(extractionRuns.id, runId));

  return {
    extracted: inserted.length,
    validated: validationResults.filter((r) => r.status === "pass").length,
    adversarialTriggered: adversarialCheck.triggered,
    adversarialResult: adversarialCheck.result?.status,
    errors,
  };
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export async function runExtractionPipeline(runId: number): Promise<ExtractionResult> {
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
    // Excel source extraction — read values from a source spreadsheet
    return extractFromExcel(fileBuffer, mappings, runId, run.companyId!, errors);
  }

  // Determine extraction mode from mappings
  // Modes: "ifrs_text", "vision:<pages>", or BIVA section codes like "[310000]"
  const sectionCodes = [
    ...new Set(mappings.map((m) => m.sourceSection).filter(Boolean)),
  ] as string[];
  const isIfrsText = sectionCodes.includes("ifrs_text");
  const visionSections = sectionCodes.filter((c) => c.startsWith("vision:"));
  const isVision = visionSections.length > 0;
  const bivaCodes = sectionCodes.filter((c) => c.startsWith("[") && !c.startsWith("vision"));

  // Extract data using appropriate method
  let sections: PdfSection[] = [];
  let textLines: ParsedLine[] = [];

  if (isVision) {
    // Vision mode: render specified pages as images, send to Claude for OCR
    // sourceSection format: "vision:33,34" → pages 33 and 34
    for (const visionCode of visionSections) {
      const pagesPart = visionCode.replace("vision:", "");
      const pages = pagesPart.split(",").map((p) => parseInt(p.trim(), 10));
      const section = await extractPdfVision(fileBuffer, pages, visionCode);
      sections.push(section);
    }
    if (sections.every((s) => s.tables[0]?.rows.length === 0)) {
      throw new Error("Vision extraction returned no table data");
    }
  } else if (isIfrsText) {
    textLines = await extractPdfText(fileBuffer);
    if (textLines.length === 0) {
      throw new Error("IFRS PDF text extraction returned no data lines");
    }
  } else {
    sections = await extractPdfTables(fileBuffer, bivaCodes.length > 0 ? bivaCodes : sectionCodes);
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

    // For vision/non-IFRS sections, sourceCol may be a numeric column index
    const visionColOverride = !isIfrsText && mapping.sourceCol
      ? (parseInt(mapping.sourceCol, 10) || null)
      : null;

    const match = isIfrsText
      ? findValueInText(textLines, mapping.sourceLabel, colIndex, pageRange)
      : findValueInSection(sections, mapping.sourceSection, mapping.sourceLabel, visionColOverride);

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

  // 9. Run adversarial validation if warnings exist (autoreason-style debate)
  const adversarialCheck = await maybeRunAdversarialValidation(
    db,
    inserted,
    mappings,
    validationResults
  );

  // 10. Update run status
  await db
    .update(extractionRuns)
    .set({ status: "extracted", extractedAt: new Date() })
    .where(eq(extractionRuns.id, runId));

  return {
    extracted: inserted.length,
    validated: validationResults.filter((r) => r.status === "pass").length,
    adversarialTriggered: adversarialCheck.triggered,
    adversarialResult: adversarialCheck.result?.status,
    errors,
  };
}
