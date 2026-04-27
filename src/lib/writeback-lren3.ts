import ExcelJS from "exceljs";
import type { CellWrite } from "./excel/surgical-writer";

type WorkbookFontColor = {
  argb?: string | null;
  rgb?: string | null;
  theme?: number | null;
};

function isFormulaLikeCellValue(
  value: unknown,
): value is { formula?: string; sharedFormula?: string } {
  return typeof value === "object" && value !== null &&
    ("formula" in value || "sharedFormula" in value);
}

function isBlackLikeFormulaColor(color: WorkbookFontColor | undefined): boolean {
  if (!color) return false;
  if (color.theme !== undefined && color.theme !== null) {
    return color.theme === 0;
  }
  const rgb = color.argb ?? color.rgb ?? null;
  if (!rgb) return false;
  const normalized = rgb.toUpperCase();
  return normalized === "FF000000" || normalized === "000000" || normalized === "FF000001";
}

export function collectLren3PreservedFormulaTargets(
  workbook: ExcelJS.Workbook,
  writes: CellWrite[],
): Set<string> {
  const preserved = new Set<string>();

  for (const write of writes) {
    const ws = workbook.getWorksheet(write.sheet);
    if (!ws) continue;

    const cell = ws.getCell(write.row, write.col);
    if (!isFormulaLikeCellValue(cell.value)) continue;
    if (!isBlackLikeFormulaColor(cell.style?.font?.color as WorkbookFontColor | undefined)) {
      continue;
    }

    preserved.add(`${write.sheet}!${cell.address}`);
  }

  return preserved;
}
