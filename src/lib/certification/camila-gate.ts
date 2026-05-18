import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, extractedValues, extractionRuns, fieldMappings } from "@/db/schema";
import { findCompanyPack } from "../../../expectations/registry";

export type CamilaGateResult =
  | { status: "skipped"; message: string; failures: string[] }
  | { status: "pass"; message: string; failures: string[] }
  | { status: "fail"; message: string; failures: string[] };

function cellKey(sheet: string, row: number): string {
  return `${sheet}:r${row}`;
}

function closeEnough(actual: number, expected: number): boolean {
  const tolerance = Math.max(0.001, Math.abs(expected) * 0.000001);
  return Math.abs(actual - expected) <= tolerance;
}

export async function runCamilaPreApprovalGate(runId: number): Promise<CamilaGateResult> {
  const db = getDb();
  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.id, runId));
  if (!run?.companyId) {
    return { status: "skipped", message: `Run ${runId} has no company`, failures: [] };
  }

  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, run.companyId));
  if (!company) {
    return { status: "skipped", message: `Run ${runId} company not found`, failures: [] };
  }

  const pack = findCompanyPack(company.ticker, run.quarter);
  if (!pack) {
    return {
      status: "skipped",
      message: `No company pack registered for ${company.ticker} ${run.quarter}`,
      failures: [],
    };
  }

  const rows = await db
    .select({
      id: extractedValues.id,
      extractedValue: extractedValues.extractedValue,
      analystOverride: extractedValues.analystOverride,
      targetSheet: fieldMappings.targetSheet,
      targetRow: fieldMappings.targetRow,
      sourceLabel: fieldMappings.sourceLabel,
    })
    .from(extractedValues)
    .innerJoin(fieldMappings, eq(extractedValues.mappingId, fieldMappings.id))
    .where(
      and(
        eq(extractedValues.runId, runId),
        eq(fieldMappings.companyId, run.companyId),
      ),
    );

  const byCell = new Map(rows.map((row) => [cellKey(row.targetSheet, row.targetRow), row]));
  const failures: string[] = [];
  const failedIds = new Map<number, string>();

  if (rows.length < pack.expectations.minExtractedValues) {
    failures.push(
      `Camila gate: extracted ${rows.length}, expected at least ${pack.expectations.minExtractedValues}`,
    );
  }

  for (const [key, expected] of Object.entries(pack.expectations.projPreApprovalCells)) {
    const row = byCell.get(key);
    if (!row) {
      failures.push(`Camila gate: missing expected ${key} (${expected.label})`);
      continue;
    }

    const actual = Number(row.analystOverride ?? row.extractedValue);
    if (!Number.isFinite(actual) || !closeEnough(actual, expected.value)) {
      const message =
        `Camila gate: ${key} ${expected.label} expected ${expected.value}, got ` +
        `${row.analystOverride ?? row.extractedValue}`;
      failures.push(message);
      failedIds.set(row.id, message);
    }
  }

  for (const [id, message] of failedIds) {
    await db
      .update(extractedValues)
      .set({
        validationStatus: "fail",
        validationMessage: message,
      })
      .where(eq(extractedValues.id, id));
  }

  if (failures.length > 0) {
    return {
      status: "fail",
      message: `${failures.length} Camila pre-approval check(s) failed`,
      failures,
    };
  }

  return {
    status: "pass",
    message: `${Object.keys(pack.expectations.projPreApprovalCells).length} Camila pre-approval cells passed`,
    failures: [],
  };
}
