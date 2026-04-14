"use server";

import { getDb } from "@/db";
import {
  extractionRuns,
  extractedValues,
  fieldMappings,
  mappingHistory,
  learningEvents,
} from "@/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

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

  // W2.2 record-vs-promote split: every analyst override writes one
  // learning_events row (the event log) and one mapping_history row
  // (the audit trail) with the pre-override state captured. We do NOT
  // mutate concept_aliases.usage_count or field_mappings.correction_count
  // here — those are promotion concerns handled by W2.3 with contradiction
  // checks and evidence gates. See
  // docs/superpowers/plans/2026-04-13-hardening-plan.md.
  if (overrides?.length) {
    const ids = overrides.map((o) => o.id);

    const [runForCompany] = await db
      .select({ companyId: extractionRuns.companyId })
      .from(extractionRuns)
      .where(eq(extractionRuns.id, runId));
    const companyId = runForCompany?.companyId ?? null;

    const currentValues = await db
      .select()
      .from(extractedValues)
      .where(inArray(extractedValues.id, ids));
    const valueById = new Map(currentValues.map((v) => [v.id, v]));

    const mappingIds = Array.from(
      new Set(
        currentValues
          .map((v) => v.mappingId)
          .filter((x): x is number => x !== null)
      )
    );
    const mappings = mappingIds.length
      ? await db
          .select()
          .from(fieldMappings)
          .where(inArray(fieldMappings.id, mappingIds))
      : [];
    const mappingById = new Map(mappings.map((m) => [m.id, m]));

    for (const { id, value: newValue } of overrides) {
      const ev = valueById.get(id);
      if (!ev) continue;
      const mapping = ev.mappingId ? mappingById.get(ev.mappingId) : null;
      const oldValue = ev.analystOverride ?? ev.extractedValue ?? null;

      // Record the event first. Idempotent via the unique index on
      // (run_id, extracted_value_id, event_type) so a double-submit is
      // a no-op.
      await db
        .insert(learningEvents)
        .values({
          eventType: "override_applied",
          entityType: "extracted_value",
          entityId: id,
          mappingId: ev.mappingId,
          runId,
          companyId,
          extractedValueId: id,
          sourceLabel: mapping?.sourceLabel ?? null,
          previousState: {
            extractedValue: ev.extractedValue,
            analystOverride: ev.analystOverride,
            confidence: ev.confidence,
            validationStatus: ev.validationStatus,
          },
          newState: { analystOverride: newValue },
          reason: "analyst_override",
          trigger: "analyst_override",
          actorType: "analyst",
          actorId: approvedBy,
        })
        .onConflictDoNothing();

      // Full audit row in mapping_history with explicit old/new and FKs.
      if (ev.mappingId !== null) {
        await db.insert(mappingHistory).values({
          mappingId: ev.mappingId,
          runId,
          extractedValueId: id,
          oldValue,
          newValue,
          previousValues: {
            extractedValue: ev.extractedValue,
            analystOverride: ev.analystOverride,
          },
          changeReason: "analyst_override",
          changedBy: approvedBy,
        });
      }

      // Apply the override.
      await db
        .update(extractedValues)
        .set({ analystOverride: newValue })
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
