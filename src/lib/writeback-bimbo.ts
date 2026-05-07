import ExcelJS from "exceljs";
import type { CellWrite } from "./excel/surgical-writer";
import {
  isBlackFormulaFontColor,
  isFormulaLikeCellValue,
  type WorkbookFontColor,
} from "./excel/formula-protection";

// Structural black-formula rows that must NOT be overwritten with extracted values.
// These are template calculations (e.g. COGS=Revenue-GrossProfit) that derive from
// the blue actuals we write. Same pattern as LREN3's FORMULA_ROW_SET.
const BIMBO_PROJ_FORMULA_ROWS = new Set([7, 11, 15, 30, 35]);
const BIMBO_FAT_FORMULA_ROWS = new Set([
  24, 26, 28, 29, 30, 31, 32, 34, 35, 36, 37, 39, 40, 41,
  50, 52, 54, 55, 56, 57, 58, 60, 61, 62, 63, 65, 66, 67,
  78, 80, 82, 83, 84, 85, 86, 88, 89, 90, 91, 93, 94, 95,
  106, 107, 109, 110, 111, 112, 113, 115, 116, 117, 118, 120, 121, 122,
]);

function isBimboFormulaRow(sheet: string, row: number): boolean {
  if (sheet === "PROJ") return BIMBO_PROJ_FORMULA_ROWS.has(row);
  if (sheet === "FAT") return BIMBO_FAT_FORMULA_ROWS.has(row);
  return false;
}

export function collectBimboPreservedFormulaTargets(
  workbook: ExcelJS.Workbook,
  writes: CellWrite[],
): Set<string> {
  const preserved = new Set<string>();

  for (const write of writes) {
    if (!isBimboFormulaRow(write.sheet, write.row)) continue;

    const ws = workbook.getWorksheet(write.sheet);
    if (!ws) continue;

    const cell = ws.getCell(write.row, write.col);
    if (!isFormulaLikeCellValue(cell.value)) continue;
    if (!isBlackFormulaFontColor(cell.style?.font?.color as WorkbookFontColor | undefined)) {
      continue;
    }

    preserved.add(`${write.sheet}!${cell.address}`);
  }

  return preserved;
}
