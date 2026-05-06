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

/**
 * In BIMBO's template, structural formulas use the default font color (no
 * explicit color = renders black in Excel). Writable cells have explicit
 * non-black colors: blue (FF0000FF) for actuals, red (FFFF0000) for
 * estimates, theme 9 for detail line items.
 *
 * Key difference from LREN3: undefined/null font color → black (preserve).
 */
function isBimboBlackFormula(color: WorkbookFontColor | undefined): boolean {
  if (!color) return true;
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
