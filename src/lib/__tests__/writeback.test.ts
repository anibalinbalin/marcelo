import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { LREN3_TEMPLATE_PATH } from "../../db/lren3-canonical";
import { collectLren3PreservedFormulaTargets } from "../writeback-lren3";

function colLetterToNumber(col: string): number {
  let n = 0;
  for (const ch of col) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

describe("LREN3 writeback filtering", () => {
  it("preserves black-style formula cells while still writing accent-colored targets", async () => {
    const templatePath = path.join(process.cwd(), LREN3_TEMPLATE_PATH);
    const templateBuffer = fs.readFileSync(templatePath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer as never);

    const cl = colLetterToNumber("CL");
    const preserved = collectLren3PreservedFormulaTargets(workbook, [
      { sheet: "FAT", row: 41, col: cl, value: 1 },
      { sheet: "FAT", row: 225, col: cl, value: 1 },
      { sheet: "PROJ", row: 122, col: cl, value: 1 },
      { sheet: "PROJ", row: 3, col: cl, value: 1 },
      { sheet: "PROJ", row: 91, col: cl, value: 1 },
      { sheet: "FAT", row: 192, col: cl, value: 1 },
    ]);

    expect([...preserved].sort()).toEqual([
      "FAT!CL225",
      "FAT!CL41",
      "PROJ!CL122",
    ]);
  });
});
