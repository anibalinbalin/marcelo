import * as ExcelJS from "exceljs";
import type { BlueCellInfo, FontColorInfo } from "./types";

/**
 * Convert a column letter (e.g. "A", "Z", "AA", "AQ") to a 1-based column number.
 */
export function colLetterToNumber(letter: string): number {
  let result = 0;
  const upper = letter.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result;
}

/**
 * Convert a 1-based column number to a column letter (e.g. 1→"A", 27→"AA", 43→"AQ").
 */
export function colNumberToLetter(num: number): string {
  let result = "";
  let n = num;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Extract hex color from an exceljs font object.
 *
 * exceljs stores font colors in `font.color.argb` (string like "FF0000FF")
 * or `font.color.theme` (number + optional tint). For argb, we take the last
 * 6 characters as the RGB hex. For theme colors, we return "theme:N" since
 * resolving them requires the workbook's theme definition.
 */
export function resolveArgbColor(font: any): string | null {
  if (!font?.color) return null;

  const color = font.color;

  if (typeof color.argb === "string" && color.argb.length >= 6) {
    const rgb = color.argb.slice(-6).toLowerCase();
    return `#${rgb}`;
  }

  if (typeof color.theme === "number") {
    return `theme:${color.theme}`;
  }

  return null;
}

/**
 * Open a workbook from a buffer, scan ALL cells across ALL sheets,
 * and extract distinct font colors sorted by count descending.
 * Includes up to 3 sample cell references per color.
 */
export async function extractFontColors(
  buffer: Buffer
): Promise<FontColorInfo[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const colorMap = new Map<string, { count: number; sampleCells: string[] }>();

  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const hex = resolveArgbColor(cell.font);
        if (!hex) return;

        let entry = colorMap.get(hex);
        if (!entry) {
          entry = { count: 0, sampleCells: [] };
          colorMap.set(hex, entry);
        }
        entry.count++;
        if (entry.sampleCells.length < 3) {
          const ref = `${sheet.name}!${colNumberToLetter(colNumber)}${rowNumber}`;
          entry.sampleCells.push(ref);
        }
      });
    });
  });

  const results: FontColorInfo[] = Array.from(colorMap.entries()).map(
    ([hex, info]) => ({ hex, count: info.count, sampleCells: info.sampleCells })
  );

  results.sort((a, b) => b.count - a.count);
  return results;
}

/**
 * Return all cells whose font color matches any of the given hex values.
 */
export async function extractBlueCells(
  buffer: Buffer,
  blueColorHexes: string[]
): Promise<BlueCellInfo[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const hexSet = new Set(blueColorHexes.map((h) => h.toLowerCase()));
  const results: BlueCellInfo[] = [];

  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const fontColor = resolveArgbColor(cell.font);
        if (!fontColor || !hexSet.has(fontColor)) return;

        let value: number | string | null = null;
        const raw = cell.value;

        if (raw === null || raw === undefined) {
          value = null;
        } else if (typeof raw === "number") {
          value = raw;
        } else if (typeof raw === "string") {
          value = raw;
        } else if (typeof raw === "object" && "result" in raw) {
          // Formula cell — use the cached result
          const result = (raw as any).result;
          value =
            typeof result === "number" || typeof result === "string"
              ? result
              : null;
        } else {
          value = String(raw);
        }

        results.push({
          sheet: sheet.name,
          row: rowNumber,
          col: colNumber,
          colLetter: colNumberToLetter(colNumber),
          value,
          fontColor,
        });
      });
    });
  });

  return results;
}

/**
 * Batch read specific cells from a workbook buffer.
 * Returns a Map keyed by "SHEET!COL_LETTER+ROW" (e.g. "PROJ!AS5").
 */
export async function readCellValues(
  buffer: Buffer,
  cells: { sheet: string; row: number; col: number }[]
): Promise<Map<string, number | string | null>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const result = new Map<string, number | string | null>();

  for (const { sheet: sheetName, row, col } of cells) {
    const key = `${sheetName}!${colNumberToLetter(col)}${row}`;
    const sheet = workbook.getWorksheet(sheetName);

    if (!sheet) {
      result.set(key, null);
      continue;
    }

    const cell = sheet.getRow(row).getCell(col);
    const raw = cell.value;

    if (raw === null || raw === undefined) {
      result.set(key, null);
    } else if (typeof raw === "number") {
      result.set(key, raw);
    } else if (typeof raw === "string") {
      result.set(key, raw);
    } else if (typeof raw === "object" && "result" in raw) {
      const res = (raw as any).result;
      result.set(
        key,
        typeof res === "number" || typeof res === "string" ? res : null
      );
    } else {
      result.set(key, String(raw));
    }
  }

  return result;
}
