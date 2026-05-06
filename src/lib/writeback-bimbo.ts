import ExcelJS from "exceljs";
import type { CellWrite } from "./excel/surgical-writer";

type WorkbookFontColor = {
  argb?: string | null;
  rgb?: string | null;
  theme?: number | null;
};

// Structural black-formula rows that must NOT be overwritten with extracted values.
// These are template calculations (e.g. COGS=Revenue-GrossProfit) that derive from
// the blue actuals we write. Same pattern as LREN3's FORMULA_ROW_SET.
const BIMBO_PROJ_FORMULA_ROWS = new Set([7, 11, 15, 30, 35]);
const BIMBO_FAT_FORMULA_ROWS = new Set<number>([]);
const FORMULA_ROW_SET = new Set([...BIMBO_PROJ_FORMULA_ROWS, ...BIMBO_FAT_FORMULA_ROWS]);

function isFormulaLikeCellValue(
  value: unknown,
): value is { formula?: string; sharedFormula?: string } {
  return typeof value === "object" && value !== null &&
    ("formula" in value || "sharedFormula" in value);
}

function isBimboBlackFormula(color: WorkbookFontColor | undefined): boolean {
  if (!color) return false;
  if (color.theme !== undefined && color.theme !== null) {
    return color.theme === 0;
  }
  const rgb = color.argb ?? color.rgb ?? null;
  if (!rgb) return false;
  const normalized = rgb.toUpperCase();
  return normalized === "FF000000" || normalized === "000000" || normalized === "FF000001";
}

export function collectBimboPreservedFormulaTargets(
  workbook: ExcelJS.Workbook,
  writes: CellWrite[],
): Set<string> {
  const preserved = new Set<string>();

  for (const write of writes) {
    if (!FORMULA_ROW_SET.has(write.row)) continue;

    const ws = workbook.getWorksheet(write.sheet);
    if (!ws) continue;

    const cell = ws.getCell(write.row, write.col);
    if (!isFormulaLikeCellValue(cell.value)) continue;
    if (!isBimboBlackFormula(cell.style?.font?.color as WorkbookFontColor | undefined)) {
      continue;
    }

    preserved.add(`${write.sheet}!${cell.address}`);
  }

  return preserved;
}
