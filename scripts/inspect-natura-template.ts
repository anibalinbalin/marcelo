/**
 * Dump the rows of the Natura quarterly template so we can identify
 * candidate Net Revenue and Gross Profit lines that should be added
 * to the NATURA field_mappings set.
 *
 * Goal: produce a worklist for Camila to review. Not touching the DB.
 *
 * Context: NTCO3 (Natura) currently catches 1/5 non-clean corruptions
 * because its mapping set has no Net Revenue or Gross Profit result
 * row, so the gross_profit arithmetic constraint can't fire. Adding
 * those two mappings (if the rows exist in the template) would move
 * NTCO3 from 1/5 toward 5/5 and lift corpus aggregate from 70% toward
 * 90%. Analyst decision — this script only proposes, it does not
 * modify mappings.
 */
import ExcelJS from "exceljs";

async function main() {
  const path = "/tmp/NATURA_limpo.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  console.log(`Sheets in ${path}:`);
  for (const ws of wb.worksheets) {
    console.log(`  [${ws.id}] "${ws.name}" — rows=${ws.rowCount}, cols=${ws.columnCount}`);
  }

  const targetSheet =
    wb.getWorksheet("Full model") ||
    wb.getWorksheet("Model") ||
    wb.worksheets[0];
  if (!targetSheet) {
    console.error("No target worksheet");
    return;
  }
  console.log(`\n## Inspecting "${targetSheet.name}"\n`);

  const keywords = [
    "net revenue",
    "net revenues",
    "net sales",
    "receita líquida",
    "receita liquida",
    "gross profit",
    "lucro bruto",
    "deductions",
    "deduções",
    "deducoes",
    "gross revenue",
    "gross revenues",
    "receita bruta",
    "ebitda",
    "operating profit",
    "operating income",
    "lucro operacional",
    "ebit",
    "cogs",
    "cost of goods",
    "custo dos produtos",
    "cost of sales",
  ];

  const hits: Array<{ row: number; col: number; text: string; addr: string }> = [];

  // Scan column A only (labels column — common in these templates)
  const maxRow = Math.min(targetSheet.rowCount, 500);
  for (let r = 1; r <= maxRow; r++) {
    const row = targetSheet.getRow(r);
    // Labels are typically in column A or B
    for (let c = 1; c <= 3; c++) {
      const cell = row.getCell(c);
      const raw = cell.value;
      if (raw == null) continue;
      const text = String(
        typeof raw === "object" && raw !== null && "richText" in raw
          ? (raw as any).richText?.map((t: any) => t.text).join("") ?? ""
          : typeof raw === "object" && raw !== null && "result" in raw
            ? (raw as any).result ?? ""
            : raw
      ).trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
        hits.push({ row: r, col: c, text, addr: cell.address });
      }
    }
  }

  console.log(`Found ${hits.length} candidate label rows:\n`);
  for (const h of hits) {
    // Pull any numeric cells on the same row to estimate which column has data
    const row = targetSheet.getRow(h.row);
    const dataCells: Array<{ col: number; addr: string; value: number }> = [];
    for (let c = h.col + 1; c <= Math.min(targetSheet.columnCount, 60); c++) {
      const cell = row.getCell(c);
      const v = cell.value;
      let num: number | null = null;
      if (typeof v === "number") num = v;
      else if (v && typeof v === "object" && "result" in (v as any) && typeof (v as any).result === "number") {
        num = (v as any).result;
      }
      if (num != null && Number.isFinite(num) && Math.abs(num) > 0.001) {
        dataCells.push({ col: c, addr: cell.address, value: num });
      }
    }
    const sample = dataCells.slice(0, 4).map((d) => `${d.addr}=${d.value.toFixed(2)}`).join(", ");
    console.log(`  ${h.addr}  "${h.text}"  →  ${dataCells.length} numeric cells${sample ? ` (${sample})` : ""}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
