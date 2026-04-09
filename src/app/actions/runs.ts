"use server";

import { getDb } from "@/db";
import { extractionRuns, extractedValues } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function getRuns(companyId: number) {
  const db = getDb();
  return db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.companyId, companyId))
    .orderBy(desc(extractionRuns.createdAt));
}

export async function getRun(runId: number) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.id, runId));
  return run ?? null;
}

export async function createRun(data: {
  companyId: number;
  quarter: string;
  sourceFileUrl: string;
}) {
  const db = getDb();
  const [run] = await db.insert(extractionRuns).values(data).returning();
  return run;
}

export async function updateRunStatus(
  runId: number,
  status: string,
  extra?: Partial<{
    extractedAt: Date;
    approvedBy: string;
    approvedAt: Date;
    outputFileUrl: string;
    errorMessage: string | null;
  }>
) {
  const db = getDb();
  const [run] = await db
    .update(extractionRuns)
    .set({ status, ...extra })
    .where(eq(extractionRuns.id, runId))
    .returning();
  return run;
}

export async function getExtractedValues(runId: number) {
  const db = getDb();
  return db
    .select()
    .from(extractedValues)
    .where(eq(extractedValues.runId, runId))
    .orderBy(extractedValues.id);
}

export async function saveExtractedValues(
  values: {
    runId: number;
    mappingId: number;
    extractedValue: string;
    confidence: number;
    validationStatus?: string;
    validationMessage?: string;
  }[]
) {
  const db = getDb();
  return db.insert(extractedValues).values(values).returning();
}

export async function approveValues(
  runId: number,
  approvedBy: string,
  overrides?: { id: number; value: string }[]
) {
  const db = getDb();

  // Apply any overrides
  if (overrides?.length) {
    for (const { id, value } of overrides) {
      await db
        .update(extractedValues)
        .set({ analystOverride: value })
        .where(eq(extractedValues.id, id));
    }
  }

  // Mark run as approved
  const [run] = await db
    .update(extractionRuns)
    .set({
      status: "approved",
      approvedBy,
      approvedAt: new Date(),
    })
    .where(eq(extractionRuns.id, runId))
    .returning();

  // Generate populated Excel and upload to Blob
  try {
    const { generatePopulatedExcel } = await import("@/lib/writeback");
    const { put } = await import("@vercel/blob");

    const result = await generatePopulatedExcel(runId);

    // If the writeback failed to land every value, skip the blob upload so
    // we never serve a silently-broken archive. The UI will fall back to the
    // /api/download route, which returns a 422 with the specific failures.
    if (result.integrityErrors.length > 0) {
      console.error(
        `[approve ${runId}] integrity FAILED, skipping blob upload:`,
        result.integrityErrors
      );
      return run;
    }

    const blob = await put(
      `output/${run.companyId}/${run.quarter}/${result.filename}`,
      result.buffer,
      { access: "public" }
    );

    // Store output URL on the run
    await db
      .update(extractionRuns)
      .set({ outputFileUrl: blob.url })
      .where(eq(extractionRuns.id, runId));

    return { ...run, outputFileUrl: blob.url };
  } catch (err) {
    // Writeback failed but approval succeeded — user can retry download later.
    console.error(`[approve ${runId}] writeback error:`, err);
    return run;
  }
}

export async function cancelRun(runId: number) {
  const db = getDb();
  const [run] = await db
    .update(extractionRuns)
    .set({ status: "cancelled" })
    .where(eq(extractionRuns.id, runId))
    .returning();
  return run;
}
