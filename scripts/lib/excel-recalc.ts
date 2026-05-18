/**
 * Force Microsoft Excel to open an xlsx, recalculate, read a list of
 * cells from one sheet, and close without saving. This is the only
 * reliable way to verify formula cells — ExcelJS cannot recompute
 * Excel's shared-formula chain, so post-approval FAT values (CPV,
 * Lucro Bruto, Receita Liq) are only trustworthy after real Excel
 * runs them.
 *
 * Proven on 2026-04-15 to recover CL3/CL7/CL11/CL15/CL26/CL30/CL34/
 * CL38/CL49/CL53 from a populated template.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve as resolvePath, isAbsolute } from "node:path";

const runFile = promisify(execFile);

const CELL_REF_RE = /^[A-Z]{1,3}\d+$/;
const SHEET_NAME_RE = /^[A-Za-z0-9 _-]{1,31}$/;

export interface RecalcOptions {
  /** Seconds to wait after `calculate` before reading cells. */
  settleSeconds?: number;
}

/**
 * Open an xlsx in Excel, recalculate, read cells, close without saving.
 * Returns a map of cell-ref → numeric value. Missing or non-numeric
 * cells come back as null.
 */
export async function recalcAndRead(
  filePath: string,
  sheet: string,
  cells: readonly string[],
  opts: RecalcOptions = {},
): Promise<Record<string, number | null>> {
  if (!isAbsolute(filePath)) {
    throw new Error(`recalcAndRead: filePath must be absolute, got "${filePath}"`);
  }
  const absPath = resolvePath(filePath);
  if (!SHEET_NAME_RE.test(sheet)) {
    throw new Error(`recalcAndRead: invalid sheet name "${sheet}"`);
  }
  for (const c of cells) {
    if (!CELL_REF_RE.test(c)) {
      throw new Error(`recalcAndRead: invalid cell ref "${c}"`);
    }
  }

  const settle = Math.max(1, Math.floor(opts.settleSeconds ?? 2));
  const readLines = cells
    .map((c) => `    set out to out & "${c}=" & ((value of cell "${c}" of ws) as text) & linefeed`)
    .join("\n");

  const script = `
tell application "Microsoft Excel"
  activate
  open POSIX file "${absPath.replace(/"/g, '\\"')}"
  delay 1
  set ws to worksheet "${sheet}" of workbook 1
  calculate
  delay ${settle}
  set out to ""
${readLines}
  close active workbook saving no
  return out
end tell
`;

  const { stdout } = await runFile("osascript", ["-e", script], { maxBuffer: 1024 * 1024 });
  const result: Record<string, number | null> = {};
  for (const c of cells) result[c] = null;
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!(key in result)) continue;
    if (raw === "" || raw === "missing value") {
      result[key] = null;
      continue;
    }
    // AppleScript coerces real numbers to text using the user's
    // macOS regional preferences. On pt-BR systems that's
    // "1234567,890000" (comma decimal, no thousands separator for
    // bare number coercion). Swap comma→period and parse.
    const normalized = raw.replace(",", ".");
    const n = Number(normalized);
    result[key] = Number.isFinite(n) ? n : null;
  }
  return result;
}
