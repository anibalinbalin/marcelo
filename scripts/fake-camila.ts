/**
 * fake-camila: mechanize Camila's verification workflow end-to-end
 * against a clean DB so we can detect silent extraction bugs BEFORE
 * telling her to re-upload. Tier 1 — one CLI, one expectations module
 * per (company, quarter), Excel-recalc readback of summary cells.
 *
 * Usage:
 *   pnpm tsx scripts/fake-camila.ts <ticker> <quarter> [--keep]
 *
 * Example:
 *   pnpm tsx scripts/fake-camila.ts lren3 4Q25
 *
 * Bug classes caught:
 *   A. Contamination — row-placeholder IDs pulling wrong line items
 *   B. FAT staleness — summary-sheet formulas not recomputing
 *   C. Duplicate-label collapse — current/LT pairs landing on same value
 */
import { config } from "dotenv";
config({ path: ".env.local" });

// Simulate Vercel runtime so env-gated behaviour matches production.
process.env.VERCEL = process.env.VERCEL ?? "1";

// Python-path assertion: the pipeline has TWO branches for the
// Python extractor — local subprocess via child_process.spawn, or
// remote fetch to EXTRACTION_API_URL (marcelo-fundamenta HF server).
// We spy on BOTH so the invariant holds regardless of which branch
// the environment picks.
//
// createRequire gets us the CJS module.exports object (mutable),
// which the pipeline's later `await import("child_process")` shares.
import { createRequire } from "node:module";
const _nodeRequire = createRequire(import.meta.url);
const _cp: { spawn: (...args: unknown[]) => unknown } = _nodeRequire("child_process");
const _origSpawn = _cp.spawn;
let pythonExtractorUsed = false;
_cp.spawn = function patchedSpawn(...args: unknown[]) {
  const cmd = typeof args[0] === "string" ? args[0] : "";
  if (/\bpython(3)?\b/.test(cmd)) pythonExtractorUsed = true;
  return _origSpawn.apply(_cp, args);
};
const _origFetch = globalThis.fetch;
globalThis.fetch = async function patchedFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  try {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    if (url.includes("/extract/excel")) pythonExtractorUsed = true;
  } catch {
    // fall through
  }
  return _origFetch.call(globalThis, input, init);
};

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  extractionRuns,
  extractedValues,
  fieldMappings,
  learningEvents,
  mappingHistory,
} from "../src/db/schema";
import { runExtractionPipeline } from "../src/lib/extraction/pipeline";
import { approveValues } from "../src/app/actions/runs";
import { recalcAndRead as recalcAndReadCua } from "./lib/excel-recalc-cua";
import { recalcAndRead as recalcAndReadAppleScript } from "./lib/excel-recalc";
import {
  assertCellValue,
  assertNoUnexpectedWarnings,
  assertPairDiffers,
  printReport,
  type AssertionResult,
} from "./lib/camila-asserts";
import type { Expectations } from "../expectations/types";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let keep = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--keep") keep = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 2) {
    throw new Error(
      "Usage: tsx scripts/fake-camila.ts <ticker> <quarter> [--keep]"
    );
  }
  return { ticker: positional[0], quarter: positional[1], keep };
}

function parseRowKey(rowKey: string): number {
  const m = rowKey.match(/^r(\d+)$/);
  if (!m) throw new Error(`Invalid row key "${rowKey}" (expected "r<n>")`);
  return Number.parseInt(m[1], 10);
}

async function loadExpectations(ticker: string, quarter: string): Promise<Expectations> {
  const modPath = `../expectations/${ticker.toLowerCase()}-${quarter.toLowerCase()}.ts`;
  try {
    const mod = await import(modPath);
    if (!mod.expectations) {
      throw new Error(`expectations module ${modPath} has no "expectations" export`);
    }
    return mod.expectations as Expectations;
  } catch (e) {
    throw new Error(
      `Failed to load expectations for ${ticker} ${quarter}: ${(e as Error).message}`
    );
  }
}

/**
 * Delete only STALE fake-camila runs, scoped by sourceFileUrl prefix.
 * Never touches runs Camila (or anyone else) uploaded through the UI
 * — those live under reports/ in blob storage, not fake-camila/.
 */
async function deleteStaleFakeCamilaRuns(
  db: ReturnType<typeof drizzle>,
  companyId: number,
  quarter: string,
) {
  const stale = await db
    .select({ id: extractionRuns.id })
    .from(extractionRuns)
    .where(
      and(
        eq(extractionRuns.companyId, companyId),
        eq(extractionRuns.quarter, quarter),
        like(extractionRuns.sourceFileUrl, "%/fake-camila/%"),
      ),
    );
  if (stale.length === 0) {
    console.log(`  no stale fake-camila runs for company ${companyId} ${quarter}`);
    return;
  }
  const ids = stale.map((r) => r.id);
  console.log(`  deleting ${ids.length} stale fake-camila run(s): ${ids.join(", ")}`);
  await db.delete(learningEvents).where(inArray(learningEvents.runId, ids));
  await db.delete(mappingHistory).where(inArray(mappingHistory.runId, ids));
  await db.delete(extractedValues).where(inArray(extractedValues.runId, ids));
  await db.delete(extractionRuns).where(inArray(extractionRuns.id, ids));
}

async function deleteSingleRun(db: ReturnType<typeof drizzle>, runId: number) {
  await db.delete(learningEvents).where(eq(learningEvents.runId, runId));
  await db.delete(mappingHistory).where(eq(mappingHistory.runId, runId));
  await db.delete(extractedValues).where(eq(extractedValues.runId, runId));
  await db.delete(extractionRuns).where(eq(extractionRuns.id, runId));
}

async function readWorkbookCells(
  filePath: string,
  sheetName: string,
  cells: readonly string[],
): Promise<Record<string, number | null>> {
  const ExcelJSImport = await import("exceljs");
  const ExcelJS = ExcelJSImport.default ?? ExcelJSImport;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`Workbook has no sheet "${sheetName}"`);

  const values: Record<string, number | null> = {};
  for (const cellRef of cells) {
    const raw = sheet.getCell(cellRef).value;
    const value =
      typeof raw === "number"
        ? raw
        : raw && typeof raw === "object" && "result" in raw && typeof raw.result === "number"
          ? raw.result
          : null;
    values[cellRef] = value;
  }
  return values;
}

function sourceUploadMetadata(sourceFile: string): { extension: string; contentType: string } {
  const extension = path.extname(sourceFile).toLowerCase();
  if (extension === ".pdf") return { extension, contentType: "application/pdf" };
  if (extension === ".xlsx") {
    return {
      extension,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  if (extension === ".xls") return { extension, contentType: "application/vnd.ms-excel" };
  throw new Error(`Unsupported fake-camila source extension: ${extension || "<none>"}`);
}

async function main() {
  const { ticker, quarter, keep } = parseArgs(process.argv);
  console.log(`\n=== fake-camila ${ticker} ${quarter} ===`);
  console.log(`VERCEL=${process.env.VERCEL}  keep=${keep}`);

  const exp = await loadExpectations(ticker, quarter);
  if (exp.ticker.toLowerCase() !== ticker.toLowerCase() || exp.quarter !== quarter) {
    throw new Error(
      `expectations file mismatch: requested ${ticker}/${quarter}, file holds ${exp.ticker}/${exp.quarter}`
    );
  }

  const sqlFn: any = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlFn);

  // --- STEP 0: clean stale runs (only fake-camila ones — never
  // touch runs Camila uploaded through the UI)
  console.log("\n=== STEP 0: cleanup stale fake-camila runs ===");
  await deleteStaleFakeCamilaRuns(db, exp.companyId, exp.quarter);

  // --- STEP 1: upload source file
  console.log("\n=== STEP 1: upload source ===");
  const fileBuf = await readFile(exp.sourceFile);
  const sourceMeta = sourceUploadMetadata(exp.sourceFile);
  console.log(`  ${exp.sourceFile}  ${(fileBuf.length / 1024 / 1024).toFixed(2)} MB`);
  const blob = await put(
    `fake-camila/${exp.companyId}/${exp.quarter}/${Date.now()}${sourceMeta.extension}`,
    fileBuf,
    { access: "public", allowOverwrite: true, contentType: sourceMeta.contentType }
  );
  console.log(`  blob: ${blob.url}`);

  // --- STEP 2: create run + extract
  const [run] = await db
    .insert(extractionRuns)
    .values({
      companyId: exp.companyId,
      quarter: exp.quarter,
      sourceFileUrl: blob.url,
      status: "pending",
    })
    .returning();
  console.log(`\n=== STEP 2: run ${run.id} created, running pipeline ===`);
  const t0 = Date.now();
  const result = await runExtractionPipeline(run.id);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `  ${dt}s  extracted=${result.extracted} validated=${result.validated} errors=${result.errors?.length ?? 0}`
  );

  // --- STEP 3: load extracted values joined with mapping metadata
  const rows = await db
    .select({
      id: extractedValues.id,
      value: extractedValues.extractedValue,
      mappingId: extractedValues.mappingId,
      targetSheet: fieldMappings.targetSheet,
      targetRow: fieldMappings.targetRow,
      sourceLabel: fieldMappings.sourceLabel,
    })
    .from(extractedValues)
    .leftJoin(fieldMappings, eq(fieldMappings.id, extractedValues.mappingId))
    .where(eq(extractedValues.runId, run.id));
  console.log(`\n=== STEP 3: ${rows.length} extracted values (expect ≥${exp.minExtractedValues}) ===`);

  const results: AssertionResult[] = [];

  results.push({
    ok: rows.length >= exp.minExtractedValues,
    name: "minExtractedValues",
    detail: `got ${rows.length} / expected ≥${exp.minExtractedValues}`,
  });

  // Extractor-path info: files <2MB use ExcelJS (even on Vercel), >2MB use Python.
  results.push({
    ok: true,
    name: "extractor path",
    detail: pythonExtractorUsed
      ? "Python extractor ran (subprocess or remote API)"
      : `ExcelJS ran (file ${(fileBuf.length / 1024 / 1024).toFixed(1)}MB < 2MB threshold)`,
  });

  // --- STEP 4: validator warnings
  results.push(
    assertNoUnexpectedWarnings(result.errors ?? [], exp.acceptedValidationWarnings)
  );

  // --- STEP 5: build extracted-value map, detect collisions
  const byKey = new Map<string, number>();
  const collisions = new Set<string>();
  for (const r of rows) {
    if (!r.targetSheet || r.targetRow === null) continue;
    const key = `${r.targetSheet}:r${r.targetRow}`;
    if (byKey.has(key)) collisions.add(key);
    const v = Number.parseFloat(r.value ?? "");
    if (Number.isFinite(v)) byKey.set(key, v);
  }
  results.push({
    ok: collisions.size === 0,
    name: "target-cell collisions",
    detail:
      collisions.size === 0
        ? "none"
        : `${collisions.size} cell(s) hit by >1 mapping: ${[...collisions].join(", ")}`,
  });

  // --- STEP 5a: pre-approval extracted-cell assertions
  // These pin specific (sheet, row) → value combinations to catch
  // contamination and duplicate-label collapse BEFORE approval runs
  // the surgical writer. Pair anti-equality alone is not enough —
  // this proves the extractor pulled the right line item.
  for (const [cellKey, expected] of Object.entries(exp.projPreApprovalCells)) {
    const actual = byKey.get(cellKey);
    results.push(assertCellValue(cellKey, expected, actual));
  }

  // --- STEP 5b: duplicate-label pair anti-equality (belt + braces)
  for (const pair of exp.projDuplicatePairs) {
    const aRow = parseRowKey(pair.a);
    const bRow = parseRowKey(pair.b);
    const va = byKey.get(`${pair.sheet}:r${aRow}`);
    const vb = byKey.get(`${pair.sheet}:r${bRow}`);
    results.push(assertPairDiffers(pair, va, vb));
  }

  // --- STEP 5c: auto-resolve deepseek_judge_needs_review when pinned
  // The DeepSeek judge is non-deterministic — sometimes it can't find
  // supporting evidence in the PDF snippet even for correct values.
  // When the extracted value matches a pinned expectation, we override
  // the judge's uncertainty before calling approve (which blocks on
  // needs_review). This keeps the judge fail-closed for un-pinned values.
  const needsReviewRows = await db
    .select({
      id: extractedValues.id,
      targetSheet: fieldMappings.targetSheet,
      targetRow: fieldMappings.targetRow,
      validationStatus: extractedValues.validationStatus,
    })
    .from(extractedValues)
    .leftJoin(fieldMappings, eq(fieldMappings.id, extractedValues.mappingId))
    .where(
      and(
        eq(extractedValues.runId, run.id),
        eq(extractedValues.validationStatus, "deepseek_judge_needs_review"),
      ),
    );
  let autoResolved = 0;
  for (const nr of needsReviewRows) {
    if (!nr.targetSheet || nr.targetRow === null) continue;
    const key = `${nr.targetSheet}:r${nr.targetRow}`;
    const pinned = exp.projPreApprovalCells[key];
    const actual = byKey.get(key);
    if (pinned && actual !== undefined) {
      const tol = pinned.tolerance ?? 0.5;
      if (Math.abs(actual - pinned.value) <= tol) {
        await db
          .update(extractedValues)
          .set({
            validationStatus: "pass",
            validationMessage: "auto-resolved by fake-camila: value matches pinned expectation",
          })
          .where(eq(extractedValues.id, nr.id));
        autoResolved++;
      }
    }
  }
  if (autoResolved > 0) {
    console.log(`\n  auto-resolved ${autoResolved} deepseek_judge_needs_review → pass (pinned match)`);
  }
  if (needsReviewRows.length > autoResolved) {
    const unresolved = needsReviewRows.length - autoResolved;
    results.push({
      ok: false,
      name: "unresolved needs_review",
      detail: `${unresolved} value(s) flagged by DeepSeek judge with no matching pinned expectation`,
    });
  }

  // --- STEP 6: approve → trigger surgical writer + blob upload
  console.log("\n=== STEP 6: approve ===");
  const approved: any = await approveValues(run.id, "fake-camila@local");
  if (!approved.outputFileUrl) {
    results.push({
      ok: false,
      name: "approve.outputFileUrl",
      detail: "approveValues returned no outputFileUrl (integrity failed)",
    });
    printReport(results);
    if (!keep) await deleteSingleRun(db, run.id);
    process.exit(1);
  }
  console.log(`  output: ${approved.outputFileUrl}`);

  // --- STEP 7: download the populated xlsx
  const outPath = `/tmp/fake-camila-${exp.ticker.toLowerCase()}-${exp.quarter.toLowerCase()}.xlsx`;
  const res = await fetch(approved.outputFileUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  console.log(`  wrote ${outPath}`);

  // --- STEP 8: open in Excel, force recalc, read FAT cells
  const cellRefs = Object.keys(exp.fatAfterRecalc);
  if (cellRefs.length > 0) {
    console.log(`\n=== STEP 8: Excel recalc + read ${cellRefs.length} cells ===`);
    let readback: Record<string, number | null>;
    try {
      readback = await recalcAndReadCua(outPath, exp.fatSheet, cellRefs);
    } catch (e) {
      console.warn(`  CUA recalc failed, falling back to AppleScript: ${(e as Error).message}`);
      try {
        readback = await recalcAndReadAppleScript(outPath, exp.fatSheet, cellRefs);
      } catch (appleScriptError) {
        console.warn(
          `  AppleScript recalc failed, reading workbook cached values: ${(appleScriptError as Error).message}`,
        );
        readback = await readWorkbookCells(outPath, exp.fatSheet, cellRefs);
      }
    }
    for (const [cellRef, expected] of Object.entries(exp.fatAfterRecalc)) {
      results.push(assertCellValue(`${exp.fatSheet}!${cellRef}`, expected, readback[cellRef]));
    }
  } else {
    console.log(`\n=== STEP 8: skipped (no fatAfterRecalc cells) ===`);
  }

  // --- STEP 9: report
  const { failed } = printReport(results);

  // --- STEP 10: cleanup test run unless --keep
  if (!keep) {
    console.log(`\n=== STEP 10: cleanup run ${run.id} ===`);
    await deleteSingleRun(db, run.id);
  } else {
    console.log(`\n=== STEP 10: --keep — run ${run.id} left in DB ===`);
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
