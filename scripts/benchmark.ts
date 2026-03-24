/**
 * Benchmark: Compare PDF extraction against analyst's manually-filled Excel model.
 *
 * 1. Read blue cells from BIMBOA 4Q25.xlsx (analyst ground truth)
 * 2. Extract tables from the BIVA PDF using pdfplumber
 * 3. Try to match extracted PDF values to the analyst's blue cells
 * 4. Report accuracy: how many fields match?
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import ExcelJS from "exceljs";
import { execFileSync } from "child_process";

const EXCEL_PATH = resolve("data/BIMBOA 4Q25.xlsx");
const PDF_PATH = resolve(
  "data/ReporteTrimestral_BIMBO_2025_4_111630-260225-2bf16217_1772054651240.pdf"
);

interface BlueCellValue {
  sheet: string;
  row: number;
  col: number;
  colLetter: string;
  rowLabel: string;
  value: number;
}

interface PdfRow {
  label: string;
  values: (number | null)[];
}

function colNumberToLetter(num: number): string {
  let result = "";
  while (num > 0) {
    num--;
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

async function readAnalystGroundTruth(): Promise<BlueCellValue[]> {
  console.log("📊 Reading analyst's filled model...");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);

  const blueCells: BlueCellValue[] = [];
  const targetSheet = wb.getWorksheet("PROJ");
  if (!targetSheet) throw new Error("PROJ sheet not found");

  // Find the column for 4Q25 — in the BIMBO model, quarterly columns start at B (1Q15)
  // 4Q25 = B + ((2025-2015)*4 + (4-1)) = B + 43 = column 2+43 = column 45 = AS
  const targetCol = 45; // AS
  const targetColLetter = colNumberToLetter(targetCol);
  console.log(`   Target column for 4Q25: ${targetColLetter} (col ${targetCol})`);

  // Read blue cells in the 4Q25 column
  targetSheet.eachRow((row, rowNum) => {
    const cell = row.getCell(targetCol);
    const font = cell.font;
    const isBlue =
      font?.color?.argb === "FF0000FF" || font?.color?.argb === "000000FF";

    if (isBlue && typeof cell.value === "number" && cell.value !== 0) {
      // Get the row label from column A
      const labelCell = row.getCell(1);
      const label = labelCell.value?.toString()?.trim() || `Row${rowNum}`;

      blueCells.push({
        sheet: "PROJ",
        row: rowNum,
        col: targetCol,
        colLetter: targetColLetter,
        rowLabel: label,
        value: cell.value,
      });
    }
  });

  console.log(
    `   Found ${blueCells.length} blue cells in PROJ column ${targetColLetter} (4Q25)`
  );
  return blueCells;
}

function extractPdfData(): PdfRow[] {
  console.log("\n📄 Extracting tables from BIVA PDF...");
  const scriptPath = resolve("src/lib/pdf/extract.py");
  const result = execFileSync(
    "python3",
    [scriptPath, PDF_PATH, "[310000]", "[210000]"],
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );
  const sections = JSON.parse(result);

  const allRows: PdfRow[] = [];
  for (const section of sections) {
    console.log(
      `   Section ${section.code}: ${section.tables.length} tables, pages ${section.pages.join(", ")}`
    );
    for (const table of section.tables) {
      for (const row of table.rows) {
        allRows.push(row);
      }
    }
  }

  console.log(`   Total extracted rows: ${allRows.length}`);
  return allRows;
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // strip parenthetical
    .replace(/[^a-záéíóúñü\s]/gi, "") // strip non-alpha
    .replace(/\s+/g, " ")
    .trim();
}

// Value comparison: BIVA reports in full units (e.g., 108,688,058,000)
// Model stores in millions (e.g., 108688) — so we need to detect the scale
function compareValues(
  pdfValue: number,
  excelValue: number
): { match: boolean; scale: string; pctDiff: number } {
  if (excelValue === 0) return { match: false, scale: "zero", pctDiff: 1 };

  // Try direct match
  if (Math.abs(pdfValue - excelValue) / Math.abs(excelValue) < 0.01) {
    return { match: true, scale: "1:1", pctDiff: 0 };
  }

  // Try PDF in units, Excel in millions (÷1,000,000)
  const pdfInMillions = pdfValue / 1_000_000;
  if (Math.abs(pdfInMillions - excelValue) / Math.abs(excelValue) < 0.01) {
    return {
      match: true,
      scale: "÷1M",
      pctDiff: Math.abs(pdfInMillions - excelValue) / Math.abs(excelValue),
    };
  }

  // Try PDF in units, Excel in thousands (÷1,000)
  const pdfInThousands = pdfValue / 1_000;
  if (Math.abs(pdfInThousands - excelValue) / Math.abs(excelValue) < 0.01) {
    return {
      match: true,
      scale: "÷1K",
      pctDiff: Math.abs(pdfInThousands - excelValue) / Math.abs(excelValue),
    };
  }

  return {
    match: false,
    scale: "none",
    pctDiff: Math.abs(pdfValue - excelValue) / Math.abs(excelValue),
  };
}

async function benchmark() {
  console.log("=== BENCHMARK: PDF Extraction vs Analyst Ground Truth ===\n");

  // 1. Read ground truth
  const groundTruth = await readAnalystGroundTruth();

  // 2. Extract from PDF
  const pdfRows = extractPdfData();

  // 3. Try to match
  console.log("\n🔍 Matching extracted PDF data to analyst values...\n");

  let matched = 0;
  let attempted = 0;
  const results: {
    excelLabel: string;
    excelValue: number;
    pdfLabel: string | null;
    pdfValue: number | null;
    match: boolean;
    scale: string;
  }[] = [];

  for (const gt of groundTruth) {
    attempted++;
    const normalizedGt = normalizeLabel(gt.rowLabel);

    // Find best matching PDF row
    let bestMatch: PdfRow | null = null;
    let bestScore = 0;

    for (const pdfRow of pdfRows) {
      const normalizedPdf = normalizeLabel(pdfRow.label);

      // Simple substring matching
      let score = 0;
      if (normalizedPdf === normalizedGt) score = 100;
      else if (normalizedPdf.includes(normalizedGt)) score = 80;
      else if (normalizedGt.includes(normalizedPdf)) score = 70;
      else {
        // Word overlap
        const gtWords = normalizedGt.split(" ");
        const pdfWords = normalizedPdf.split(" ");
        const overlap = gtWords.filter((w) =>
          pdfWords.some((pw) => pw.includes(w) || w.includes(pw))
        );
        score = (overlap.length / Math.max(gtWords.length, 1)) * 60;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = pdfRow;
      }
    }

    if (bestMatch && bestScore >= 50) {
      // The BIVA table has columns: [Annual Current, Annual Prior, Q4 Current, Q4 Prior]
      // We want Q4 Current = index 2 (3rd column)
      const pdfValue =
        bestMatch.values.length >= 3
          ? bestMatch.values[2] ?? bestMatch.values[0]
          : bestMatch.values[0];

      if (pdfValue !== null) {
        const cmp = compareValues(pdfValue, gt.value);
        results.push({
          excelLabel: gt.rowLabel,
          excelValue: gt.value,
          pdfLabel: bestMatch.label,
          pdfValue,
          match: cmp.match,
          scale: cmp.scale,
        });
        if (cmp.match) matched++;
      } else {
        results.push({
          excelLabel: gt.rowLabel,
          excelValue: gt.value,
          pdfLabel: bestMatch.label,
          pdfValue: null,
          match: false,
          scale: "no value",
        });
      }
    } else {
      results.push({
        excelLabel: gt.rowLabel,
        excelValue: gt.value,
        pdfLabel: null,
        pdfValue: null,
        match: false,
        scale: "no match",
      });
    }
  }

  // 4. Report
  console.log("RESULTS:");
  console.log("─".repeat(120));
  console.log(
    `${"Excel Label".padEnd(35)} ${"Excel Value".padStart(15)} ${"PDF Label".padEnd(35)} ${"PDF Value".padStart(18)} ${"Match".padStart(8)} ${"Scale".padStart(8)}`
  );
  console.log("─".repeat(120));

  for (const r of results) {
    const exLabel = r.excelLabel.substring(0, 33).padEnd(35);
    const exVal = r.excelValue.toLocaleString().padStart(15);
    const pdfLabel = (r.pdfLabel?.substring(0, 33) ?? "NOT FOUND").padEnd(35);
    const pdfVal =
      r.pdfValue !== null
        ? r.pdfValue.toLocaleString().padStart(18)
        : "—".padStart(18);
    const matchStr = r.match ? "  ✓" : "  ✗";
    const scaleStr = r.scale.padStart(8);

    console.log(
      `${exLabel} ${exVal} ${pdfLabel} ${pdfVal} ${matchStr} ${scaleStr}`
    );
  }

  console.log("─".repeat(120));
  console.log(
    `\n📊 ACCURACY: ${matched}/${attempted} fields matched (${((matched / attempted) * 100).toFixed(1)}%)`
  );
  console.log(`   Matched: ${matched}`);
  console.log(`   Not matched: ${attempted - matched}`);

  // Show scale distribution
  const scales = results.filter((r) => r.match).reduce(
    (acc, r) => {
      acc[r.scale] = (acc[r.scale] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  if (Object.keys(scales).length > 0) {
    console.log(`   Scale distribution:`, scales);
    console.log(
      `   → This tells us the unit conversion needed for the mapping (value_transform)`
    );
  }
}

benchmark().catch(console.error);
