/**
 * Writeback orchestrator — generates a populated Excel model from approved extraction data.
 */
import ExcelJS from "exceljs";
import { getDb } from "@/db";
import { extractionRuns, extractedValues, fieldMappings, companies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { writeBlueValues, type CellWrite } from "@/lib/excel/surgical-writer";
import { quarterToColOffset, getTargetCol } from "@/lib/quarter";
import { colLetterToNumber } from "@/lib/excel/reader";
import { collectLren3PreservedFormulaTargets } from "@/lib/writeback-lren3";

export interface WritebackResult {
  buffer: Buffer;
  filename: string;
  cellsWritten: number;
  integrityErrors: string[];
  integrityWarnings: string[];
}

export async function generatePopulatedExcel(runId: number): Promise<WritebackResult> {
  const db = getDb();

  // 1. Fetch run + company
  const [run] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, runId));
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "approved") throw new Error(`Run ${runId} is not approved (status: ${run.status})`);

  if (!run.companyId) throw new Error(`Run ${runId} has no company ID`);
  const [company] = await db.select().from(companies).where(eq(companies.id, run.companyId));
  if (!company) throw new Error(`Company ${run.companyId} not found`);
  if (!company.modelTemplateBlobUrl) throw new Error(`No model template uploaded for ${company.name}`);

  // 2. Fetch approved values + their mappings
  const values = await db
    .select({
      extractedValue: extractedValues.extractedValue,
      analystOverride: extractedValues.analystOverride,
      mappingId: extractedValues.mappingId,
      targetSheet: fieldMappings.targetSheet,
      targetRow: fieldMappings.targetRow,
      targetColBase: fieldMappings.targetColBase,
      targetColStep: fieldMappings.targetColStep,
      baseQuarter: fieldMappings.baseQuarter,
      colMode: fieldMappings.colMode,
    })
    .from(extractedValues)
    .innerJoin(fieldMappings, eq(extractedValues.mappingId, fieldMappings.id))
    // Stale extracted_values must not resurrect mappings that were later
    // deactivated from the canonical set.
    .where(and(eq(extractedValues.runId, runId), eq(fieldMappings.isActive, true)));

  // 3. Download model template from Vercel Blob
  const templateResponse = await fetch(company.modelTemplateBlobUrl);
  if (!templateResponse.ok) throw new Error(`Failed to download template: ${templateResponse.statusText}`);
  const templateBuffer = Buffer.from(await templateResponse.arrayBuffer());

  // 4. Calculate target cells and prepare writes
  const cellWrites: CellWrite[] = [];
  for (const v of values) {
    const valueStr = v.analystOverride ?? v.extractedValue;
    if (!valueStr) continue;

    const numValue = parseFloat(valueStr);
    if (isNaN(numValue)) continue;

    let targetCol: number;
    if (v.colMode === "fixed") {
      // Fixed column — use base col directly
      targetCol = colLetterToNumber(v.targetColBase);
    } else {
      // Quarterly offset
      const offset = quarterToColOffset(run.quarter, v.baseQuarter);
      const colLetter = getTargetCol(v.targetColBase, v.targetColStep ?? 1, offset);
      targetCol = colLetterToNumber(colLetter);
    }

    cellWrites.push({
      sheet: v.targetSheet,
      row: v.targetRow,
      col: targetCol,
      value: numValue,
    });
  }

  let writesToApply = cellWrites;
  const writebackWarnings: string[] = [];

  if (company.ticker === "LREN3" && cellWrites.length > 0) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer as never);

    const preservedTargets = collectLren3PreservedFormulaTargets(workbook, cellWrites);
    if (preservedTargets.size > 0) {
      writesToApply = cellWrites.filter((write) => {
        const addr = workbook.getWorksheet(write.sheet)?.getCell(write.row, write.col).address;
        return !addr || !preservedTargets.has(`${write.sheet}!${addr}`);
      });
      writebackWarnings.push(
        `LREN3 preserved template formulas at ${[...preservedTargets].sort().join(", ")}`,
      );
    }
  }

  // 5. Write values into the template
  const { buffer, integrityReport } = await writeBlueValues(templateBuffer, writesToApply);

  // 6. Build filename
  const filename = `${company.ticker}_${run.quarter}_populated.xlsx`;

  return {
    buffer,
    filename,
    cellsWritten: writesToApply.length,
    integrityErrors: integrityReport.errors,
    integrityWarnings: [...writebackWarnings, ...integrityReport.warnings],
  };
}
