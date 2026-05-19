import { describe, expect, it } from "vitest";
import * as ExcelJS from "exceljs";
import { suggestXlsxMappings } from "../suggest-xlsx-mappings";

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("suggestXlsxMappings", () => {
  it("matches Camila's completed model value to a BIVA source row with transform evidence", async () => {
    const base = new ExcelJS.Workbook();
    const proj = base.addWorksheet("PROJ");
    proj.getCell("A3").value = "Ingresos";
    proj.getCell("B3").value = 1624728;

    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet("310000");
    sheet.getCell("A3").value = "Concepto";
    sheet.getCell("B3").value = "Trimestre Actual";
    sheet.getCell("A4").value = "Ingresos";
    sheet.getCell("B4").value = 1624728000;

    const result = await suggestXlsxMappings(
      await workbookBuffer(base),
      await workbookBuffer(source),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      sourceSection: "[310000]",
      sourceLabel: "Ingresos",
      sourceRow: 4,
      valueTransform: "divide_1000",
      target: { sheet: "PROJ", row: 3 },
    });
    expect(result.candidates[0].evidence).toMatchObject({
      sourceValue: 1624728000,
      targetValue: 1624728,
      transformedValue: 1624728,
      sourceAddress: "310000!B4",
      targetAddress: "PROJ!B3",
    });
  });

  it("marks duplicate value matches as review-required instead of high-confidence auto-accept", async () => {
    const base = new ExcelJS.Workbook();
    const proj = base.addWorksheet("PROJ");
    proj.getCell("A3").value = "Ingresos";
    proj.getCell("B3").value = 1000;

    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet("310000");
    sheet.getCell("A3").value = "Concepto";
    sheet.getCell("B3").value = "Trimestre Actual";
    sheet.getCell("A4").value = "Ingresos";
    sheet.getCell("B4").value = 1000000;
    sheet.getCell("A5").value = "Ventas netas";
    sheet.getCell("B5").value = 1000000;

    const result = await suggestXlsxMappings(
      await workbookBuffer(base),
      await workbookBuffer(source),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].confidence).toBeLessThan(0.85);
    expect(result.candidates[0].reviewReasons).toContain(
      "2 source rows can explain PROJ!B3",
    );
  });
});
