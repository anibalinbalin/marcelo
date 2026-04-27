import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  LREN3_CANONICAL_MAPPINGS,
  LREN3_TEMPLATE_PATH,
} from "../../../db/lren3-canonical";
import { writeBlueValues } from "../surgical-writer";

const REPORTED_FORMULA_CELLS = {
  FAT: ["CL138", "CL191", "CL240"],
  PROJ: ["CL96", "CL102", "CL107", "CL108", "CL128"],
} as const;

function colLetterToNumber(col: string): number {
  let n = 0;
  for (const ch of col) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function parseWorkbookSheets(workbookXml: string, relsXml: string): Map<string, string> {
  const relIdToTarget = new Map<string, string>();
  const relIterator = relsXml.matchAll(
    /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g,
  );
  for (const match of relIterator) {
    relIdToTarget.set(match[1], match[2]);
  }

  const sheets = new Map<string, string>();
  const sheetIterator = workbookXml.matchAll(
    /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g,
  );
  for (const match of sheetIterator) {
    const target = relIdToTarget.get(match[2]);
    if (!target) continue;
    sheets.set(match[1], target.startsWith("/") ? target.replace(/^\/+/, "") : `xl/${target}`);
  }
  return sheets;
}

function getCellXml(sheetXml: string, addr: string): string | null {
  const re = new RegExp(
    `<c\\b[^>]*\\br="${addr}"[^>]*(?:/>|>[\\s\\S]*?</c>)`,
  );
  const match = sheetXml.match(re);
  return match ? match[0] : null;
}

async function readWorkbookCells(
  buffer: Buffer,
  cellsBySheet: Record<string, readonly string[]>,
): Promise<Record<string, Record<string, string | null>>> {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const sheetMap = parseWorkbookSheets(workbookXml, relsXml);

  const out: Record<string, Record<string, string | null>> = {};
  for (const [sheet, addrs] of Object.entries(cellsBySheet)) {
    const sheetXml = await zip.file(sheetMap.get(sheet)!)!.async("string");
    out[sheet] = {};
    for (const addr of addrs) {
      out[sheet][addr] = getCellXml(sheetXml, addr);
    }
  }
  return out;
}

describe("surgical writer", () => {
  it("preserves existing LREN3 CL formulas outside the mapped cells", async () => {
    const templatePath = path.join(process.cwd(), LREN3_TEMPLATE_PATH);
    const templateBuffer = fs.readFileSync(templatePath);
    const before = await readWorkbookCells(templateBuffer, REPORTED_FORMULA_CELLS);

    const writes = LREN3_CANONICAL_MAPPINGS.map((mapping, index) => ({
      sheet: mapping.targetSheet,
      row: mapping.targetRow,
      col: colLetterToNumber("CL"),
      value: 1000 + index,
    }));

    const { buffer, integrityReport } = await writeBlueValues(templateBuffer, writes);
    const after = await readWorkbookCells(buffer, REPORTED_FORMULA_CELLS);

    expect(integrityReport.errors).toEqual([]);
    expect(integrityReport.writtenCellsVerified).toBe(true);
    expect(after).toEqual(before);

    const outputCells = await readWorkbookCells(buffer, {
      PROJ: ["CL94"],
      FAT: ["CL189"],
    });
    expect(outputCells.PROJ.CL94).toContain("<v>1014</v>");
    expect(outputCells.PROJ.CL94).not.toContain("<f");
    expect(outputCells.FAT.CL189).toContain("<v>1056</v>");
    expect(outputCells.FAT.CL189).not.toContain("<f");
  });
});
