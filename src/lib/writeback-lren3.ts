import ExcelJS from "exceljs";
import type { CellWrite } from "./excel/surgical-writer";
import { LREN3_PROJ_FORMULA_ROWS, LREN3_FAT_FORMULA_ROWS } from "@/db/lren3-canonical";

const FORMULA_ROW_SET = new Set<number>([
  ...LREN3_PROJ_FORMULA_ROWS,
  ...LREN3_FAT_FORMULA_ROWS,
]);

const FAT_PROTECTED_ROWS = [132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146];
const PROJ_PROTECTED_ROWS = [97];
export const LREN3_CLEAR_ROWS = [97];

function colNumberToLetter(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export function buildLren3ProtectedAddrs(targetCol: number): Set<string> {
  const col = colNumberToLetter(targetCol);
  const addrs = new Set<string>();
  for (const r of FAT_PROTECTED_ROWS) addrs.add(`FAT!${col}${r}`);
  for (const r of PROJ_PROTECTED_ROWS) addrs.add(`PROJ!${col}${r}`);
  return addrs;
}

const FAT_FORCE_CLONE_ROWS = [130];

export function buildLren3ForceCloneAddrs(targetCol: number): Set<string> {
  const col = colNumberToLetter(targetCol);
  const addrs = new Set<string>();
  for (const r of FAT_FORCE_CLONE_ROWS) addrs.add(`FAT!${col}${r}`);
  return addrs;
}

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
    if (!FORMULA_ROW_SET.has(write.row)) continue;

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
