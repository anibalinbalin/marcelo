import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { collectBimboPreservedFormulaTargets } from "../writeback-bimbo";
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
    const workbook = new ExcelJS.Workbook();
    const fat = workbook.addWorksheet("FAT");
    const proj = workbook.addWorksheet("PROJ");

    const cl = colLetterToNumber("CL");
    fat.getCell(53, cl).value = { formula: "+CL258" };
    fat.getCell(53, cl).font = { color: { theme: 0 } };

    proj.getCell(96, cl).value = { sharedFormula: "CI96" };
    proj.getCell(96, cl).font = { color: { argb: "FF008000" } };

    proj.getCell(102, cl).value = { sharedFormula: "CI102" };
    proj.getCell(102, cl).font = { color: { argb: "FFFF0000" } };

    const preserved = collectLren3PreservedFormulaTargets(workbook, [
      { sheet: "FAT", row: 53, col: cl, value: 1 },
      { sheet: "PROJ", row: 96, col: cl, value: 1 },
      { sheet: "PROJ", row: 102, col: cl, value: 1 },
    ]);

    expect([...preserved].sort()).toEqual(["FAT!CL53"]);
  });
});

describe("BIMBO writeback filtering", () => {
  it("uses sheet-specific formula rows and protects FAT formulas", () => {
    const workbook = new ExcelJS.Workbook();
    const proj = workbook.addWorksheet("PROJ");
    const fat = workbook.addWorksheet("FAT");
    const col = colLetterToNumber("AS");

    proj.getCell(7, col).value = { formula: "+AS9-AS5" };
    proj.getCell(7, col).font = { color: { argb: "FF000000" } };

    fat.getCell(24, col).value = { formula: "AF24" };
    fat.getCell(24, col).font = { color: { argb: "FF000000" } };

    fat.getCell(7, col).value = { formula: "+Macro!BN40" };
    fat.getCell(7, col).font = { color: { argb: "FF000000" } };

    const preserved = collectBimboPreservedFormulaTargets(workbook, [
      { sheet: "PROJ", row: 7, col, value: 1 },
      { sheet: "FAT", row: 24, col, value: 1 },
      { sheet: "FAT", row: 7, col, value: 1 },
    ]);

    expect([...preserved].sort()).toEqual(["FAT!AS24", "PROJ!AS7"]);
  });

  it("does not treat tinted theme-0 text as black formula text", () => {
    const workbook = new ExcelJS.Workbook();
    const proj = workbook.addWorksheet("PROJ");
    const col = colLetterToNumber("AS");

    proj.getCell(7, col).value = { formula: "+AS9-AS5" };
    proj.getCell(7, col).font = { color: { theme: 0, tint: 0.5 } };

    const preserved = collectBimboPreservedFormulaTargets(workbook, [
      { sheet: "PROJ", row: 7, col, value: 1 },
    ]);

    expect([...preserved]).toEqual([]);
  });
});
