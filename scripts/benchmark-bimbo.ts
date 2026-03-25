/**
 * BIMBO Benchmark: Uses actual seed mappings to extract from BIVA PDF,
 * then compares transformed values against analyst's Excel ground truth.
 */
import { execFileSync } from "child_process";
import { resolve } from "path";
import ExcelJS from "exceljs";

const PDF_PATH = resolve("data/ReporteTrimestral_BIMBO_2025_4_111630-260225-2bf16217_1772054651240.pdf");
const EXCEL_PATH = resolve("data/BIMBOA 4Q25.xlsx");

const BIMBO_MAPPINGS = [
  { sourceSection: "[310000]", sourceLabel: "Ingresos", targetRow: 5, valueTransform: "divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Costo de ventas", targetRow: 7, valueTransform: "negate_divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad bruta", targetRow: 9, valueTransform: "divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Gastos de venta", targetRow: 11, valueTransform: "negate_divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) de operación", targetRow: 13, valueTransform: "divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Ingresos financieros", targetRow: 15, valueTransform: "divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Gastos financieros", targetRow: 16, valueTransform: "negate_divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Participación en la utilidad (pérdida) de asociadas y negocios conjuntos", targetRow: 29, valueTransform: "divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) antes de impuestos", targetRow: 30, valueTransform: "divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Impuestos a la utilidad", targetRow: 31, valueTransform: "negate_divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) neta", targetRow: 35, valueTransform: "divide_1000000" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) atribuible a la participación no controladora", targetRow: 33, valueTransform: "negate_divide_1000000" },
  { sourceSection: "[210000]", sourceLabel: "Efectivo y equivalentes de efectivo", targetRow: 42, valueTransform: "divide_1000000" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos circulantes", targetRow: 45, valueTransform: "divide_1000000" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos", targetRow: 55, valueTransform: "divide_1000000" },
  { sourceSection: "[210000]", sourceLabel: "Total de pasivos circulantes", targetRow: 60, valueTransform: "divide_1000000" },
  { sourceSection: "[210000]", sourceLabel: "Total pasivos", targetRow: 70, valueTransform: "divide_1000000" },
  { sourceSection: "[210000]", sourceLabel: "Total de capital contable", targetRow: 80, valueTransform: "divide_1000000" },
];

function normalizeLabel(l: string): string {
  return l.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-záéíóúñü\s]/gi, "").replace(/\s+/g, " ").trim();
}

async function main() {
  // 1. Extract from PDF
  console.log("Extracting from BIVA PDF...\n");
  const scriptPath = resolve("src/lib/pdf/extract.py");
  const raw = execFileSync("python3", [scriptPath, PDF_PATH, "[310000]", "[210000]"], {
    encoding: "utf-8", maxBuffer: 10 * 1024 * 1024,
  });
  const sections = JSON.parse(raw);

  // Build lookup
  const sectionRows: Record<string, { label: string; values: (number | null)[] }[]> = {};
  for (const sec of sections) {
    sectionRows[sec.code] = [];
    for (const table of sec.tables) {
      for (const row of table.rows) {
        sectionRows[sec.code].push(row);
      }
    }
    console.log(`  ${sec.code}: ${sectionRows[sec.code].length} rows extracted`);
  }

  // 2. Read Excel ground truth
  console.log("\nReading Excel ground truth (PROJ sheet, col AS = 4Q25)...\n");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const sheet = wb.getWorksheet("PROJ")!;
  const targetCol = 45; // AS = 4Q25

  // 3. Match each mapping
  console.log(`${"Mapping Label".padEnd(50)} ${"PDF Raw".padStart(18)} ${"Transformed".padStart(14)} ${"Excel".padStart(14)} ${"OK".padStart(4)}`);
  console.log("─".repeat(104));

  let matched = 0;
  let total = 0;
  const failures: string[] = [];

  for (const m of BIMBO_MAPPINGS) {
    total++;
    const rows = sectionRows[m.sourceSection] || [];
    const target = normalizeLabel(m.sourceLabel);

    // Find best matching row — prefer exact, then closest-length contains match
    let bestRow: (typeof rows)[0] | null = null;
    let bestScore = 0;
    let bestLengthDiff = Infinity;
    for (const row of rows) {
      const norm = normalizeLabel(row.label);
      let score = 0;
      if (norm === target) score = 100;
      else if (norm.includes(target) || target.includes(norm)) score = 70;
      const lengthDiff = Math.abs(norm.length - target.length);
      if (score > bestScore || (score === bestScore && lengthDiff < bestLengthDiff)) {
        bestScore = score; bestRow = row; bestLengthDiff = lengthDiff;
      }
    }

    // BIVA tables: [Annual Current, Annual Prior, Q4 Current, Q4 Prior]
    const pdfRaw = bestRow && bestRow.values.length >= 3 ? bestRow.values[2] : (bestRow?.values[0] ?? null);

    // Apply transform
    let transformed: number | null = null;
    if (pdfRaw !== null) {
      switch (m.valueTransform) {
        case "divide_1000000": transformed = Math.round(pdfRaw / 1_000_000); break;
        case "negate_divide_1000000": transformed = Math.round(-pdfRaw / 1_000_000); break;
        case "negate": transformed = Math.round(-pdfRaw); break;
        default: transformed = Math.round(pdfRaw);
      }
    }

    // Excel value
    const excelCell = sheet.getRow(m.targetRow).getCell(targetCol);
    const excelVal = typeof excelCell.value === "number" ? Math.round(excelCell.value) : null;

    const isMatch = transformed !== null && excelVal !== null && transformed === excelVal;
    if (isMatch) matched++;

    const label = m.sourceLabel.substring(0, 48).padEnd(50);
    const rawStr = pdfRaw !== null ? pdfRaw.toLocaleString().padStart(18) : "NOT FOUND".padStart(18);
    const transStr = transformed !== null ? transformed.toLocaleString().padStart(14) : "—".padStart(14);
    const excelStr = excelVal !== null ? excelVal.toLocaleString().padStart(14) : "(empty)".padStart(14);
    const matchStr = isMatch ? " ✓" : (excelVal === null ? " ?" : " ✗");

    console.log(`${label} ${rawStr} ${transStr} ${excelStr} ${matchStr}`);

    if (!isMatch && excelVal !== null) {
      failures.push(`  ${m.sourceLabel}: extracted=${transformed}, expected=${excelVal}, diff=${transformed !== null ? transformed - excelVal : "N/A"}`);
    }
  }

  console.log("─".repeat(104));
  console.log(`\nACCURACY: ${matched}/${total} (${((matched / total) * 100).toFixed(1)}%)`);

  if (failures.length > 0) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.log(f);
  }
}

main().catch(console.error);
