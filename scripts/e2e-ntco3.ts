/**
 * NTCO3 / Natura &Co E2E using Camila's local source workbook.
 *
 * Creates a temporary run, executes extraction, approves it to exercise
 * writeback generation, verifies written cells from the fresh workbook
 * buffer, then deletes the run and temporary source blob.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.FORCE_LOCAL_EXCEL_EXTRACTION = "1";

import ExcelJS from "exceljs";
import { put, del } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray } from "drizzle-orm";
import {
  extractionRuns,
  extractedValues,
  fieldMappings,
  learningEvents,
  mappingHistory,
} from "../src/db/schema";
import { runExtractionPipeline } from "../src/lib/extraction/pipeline";
import { approveValues } from "../src/app/actions/runs";
import { generatePopulatedExcel } from "../src/lib/writeback";
import { quarterToColOffset, getTargetCol } from "../src/lib/quarter";
import { colLetterToNumber } from "../src/lib/excel/reader";

const COMPANY_ID = 8;
const TICKER = "NTCO3";
const QUARTER = "4Q25";
const SOURCE_PATH = "public/camila/Natura_Planilha_Resultados_download.xlsx";

async function cleanup(db: ReturnType<typeof drizzle>, runId: number) {
  const values = await db
    .select({ id: extractedValues.id })
    .from(extractedValues)
    .where(eq(extractedValues.runId, runId));
  const valueIds = values.map((v) => v.id);

  await db.delete(learningEvents).where(eq(learningEvents.runId, runId));
  await db.delete(mappingHistory).where(eq(mappingHistory.runId, runId));
  if (valueIds.length > 0) {
    await db.delete(extractedValues).where(inArray(extractedValues.id, valueIds));
  }
  await db.delete(extractionRuns).where(eq(extractionRuns.id, runId));
}

function cellNumber(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value) {
    const result = (value as { result?: unknown }).result;
    return typeof result === "number" ? result : Number(result);
  }
  return Number(value);
}

async function main() {
  const sqlFn = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlFn);
  let runId: number | null = null;
  const blobUrls: string[] = [];

  try {
    console.log("uploading NTCO3 source workbook to blob...");
    const sourceBuffer = readFileSync(SOURCE_PATH);
    const blob = await put(
      `reports/${COMPANY_ID}/${QUARTER}/${Date.now()}-ntco3-e2e.xlsx`,
      sourceBuffer,
      {
        access: "public",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );
    blobUrls.push(blob.url);
    console.log(`source uploaded: ${blob.url}`);

    const [run] = await db
      .insert(extractionRuns)
      .values({
        companyId: COMPANY_ID,
        quarter: QUARTER,
        sourceFileUrl: blob.url,
        status: "pending",
      })
      .returning();
    runId = run.id;
    console.log(`run ${run.id} created`);

    const start = Date.now();
    const result = await runExtractionPipeline(run.id);
    console.log(
      `pipeline ${((Date.now() - start) / 1000).toFixed(1)}s: ` +
        `extracted=${result.extracted} validated=${result.validated} ` +
        `errors=${result.errors?.length ?? 0}`,
    );
    for (const error of result.errors ?? []) {
      console.log(`pipeline error: ${error}`);
    }

    const values = await db
      .select({
        extractedValue: extractedValues.extractedValue,
        analystOverride: extractedValues.analystOverride,
        status: extractedValues.validationStatus,
        msg: extractedValues.validationMessage,
        targetSheet: fieldMappings.targetSheet,
        targetRow: fieldMappings.targetRow,
        targetColBase: fieldMappings.targetColBase,
        targetColStep: fieldMappings.targetColStep,
        baseQuarter: fieldMappings.baseQuarter,
        colMode: fieldMappings.colMode,
        sourceLabel: fieldMappings.sourceLabel,
      })
      .from(extractedValues)
      .innerJoin(fieldMappings, eq(extractedValues.mappingId, fieldMappings.id))
      .where(eq(extractedValues.runId, run.id));
    console.log(`values: ${values.length}`);

    const warnings = values.filter((v) => v.status && v.status !== "pass");
    for (const warning of warnings) {
      console.log(
        `warn: ${warning.sourceLabel} = ${warning.extractedValue} ` +
          `[${warning.status}] ${warning.msg ?? ""}`,
      );
    }

    const approved = await approveValues(run.id, "e2e-ntco3@local", []);
    console.log(`approved, output=${approved.outputFileUrl ?? "(none)"}`);
    if (!approved.outputFileUrl) throw new Error("approveValues returned no output file");

    const generated = await generatePopulatedExcel(run.id);
    if (generated.integrityErrors.length > 0) {
      throw new Error(`writeback integrity failed: ${JSON.stringify(generated.integrityErrors)}`);
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(generated.buffer as never);

    let ok = 0;
    let fail = 0;
    for (const value of values) {
      const expected = Number(value.analystOverride ?? value.extractedValue ?? "0");
      const col =
        value.colMode === "fixed"
          ? colLetterToNumber(value.targetColBase)
          : colLetterToNumber(
              getTargetCol(
                value.targetColBase,
                value.targetColStep ?? 1,
                quarterToColOffset(run.quarter, value.baseQuarter),
              ),
            );
      const sheet = workbook.getWorksheet(value.targetSheet);
      const actual = sheet ? cellNumber(sheet.getCell(value.targetRow, col)) : NaN;
      if (Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6) {
        ok++;
      } else {
        fail++;
        console.log(
          `fail: ${value.sourceLabel} ${value.targetSheet}!R${value.targetRow}C${col} ` +
            `expected=${expected} actual=${actual}`,
        );
      }
    }

    console.log(`${ok}/${values.length} written cells correct`);
    if (values.length === 0 || fail > 0 || (result.errors?.length ?? 0) > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (runId !== null && !process.argv.includes("--keep-run")) {
      await cleanup(db, runId);
      console.log(`cleaned up run ${runId}`);
    }
    if (!process.argv.includes("--keep-blob") && blobUrls.length > 0) {
      await del(blobUrls);
      console.log(`deleted source blob artifacts: ${blobUrls.length}`);
    }
    console.log(`${TICKER} ${QUARTER} e2e done`);
  }
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
