/**
 * scripts/promote-learning-events.ts
 *
 * W2.3 promotion pipeline.
 *
 * Reads recent `override_applied` events from `learning_events`, groups
 * them by `(company_id, mapping_id)`, and applies an evidence gate:
 * when the same field mapping has been corrected by the analyst in
 * ≥ N distinct runs, decrement its `confidence_score` and increment
 * its `correction_count`. Writes a `confidence_updated` event per
 * promotion so the full causal chain is visible in the log.
 *
 * This is promotion in the strict sense — the event log is the
 * authoritative record, and the promoter reads it to aggregate signal
 * into shared semantic memory only once evidence crosses a threshold.
 * A single override never mutates field_mappings.confidence_score or
 * concept_aliases.usage_count — W2.2 keeps that separation strict.
 *
 * Contradiction check: if overrides on the same mapping span conflicting
 * patterns (e.g., some push the value up 10x, others fix a sign flip),
 * we flag the mapping via a `lint_flagged` event instead of promoting,
 * so the analyst can review before shared memory is touched.
 *
 * Idempotency: the unique index on (run_id, extracted_value_id,
 * event_type) protects us — each promotion uses the cluster's latest
 * run_id, so re-running the script on the same data is a no-op until
 * new override events arrive.
 *
 * Usage:
 *   pnpm tsx scripts/promote-learning-events.ts                    # dry-run
 *   pnpm tsx scripts/promote-learning-events.ts --apply            # write
 *   pnpm tsx scripts/promote-learning-events.ts --min-evidence 5   # custom N
 *   pnpm tsx scripts/promote-learning-events.ts --company-id 3     # scope
 *
 * Exit codes: 0 on success (even if nothing promoted), 1 on error.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  fieldMappings,
  learningEvents,
  companies,
} from "../src/db/schema";

// ── Args ─────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");
const MIN_EVIDENCE = parseInt(argValue("--min-evidence") ?? "3", 10);
const COMPANY_FILTER = argValue("--company-id");
const COMPANY_ID = COMPANY_FILTER ? parseInt(COMPANY_FILTER, 10) : null;

// Per-promotion decrement on confidence_score. Bounded so a single
// promotion cycle can't collapse a mapping from 1.0 to 0 in one hit.
const CONFIDENCE_STEP = 0.05;
const MIN_CONFIDENCE = 0.0;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

// ── Main ─────────────────────────────────────────────────────────────────────

type OverrideRow = {
  id: number;
  runId: number | null;
  mappingId: number | null;
  companyId: number | null;
  extractedValueId: number | null;
  sourceLabel: string | null;
  previousState: unknown;
  newState: unknown;
  createdAt: Date | null;
};

type Cluster = {
  mappingId: number;
  companyId: number | null;
  sourceLabel: string | null;
  runs: Set<number>;
  latestRunId: number;
  events: OverrideRow[];
  // Numeric delta samples for contradiction checks: new/old ratio, or
  // null when either side is non-numeric.
  deltaRatios: (number | null)[];
};

async function main() {
  const neonSql = neon(process.env.DATABASE_URL!);
  const db = drizzle(neonSql);

  // Fetch all override_applied events. Scope to company if requested.
  const baseWhere = and(
    eq(learningEvents.eventType, "override_applied"),
    COMPANY_ID !== null ? eq(learningEvents.companyId, COMPANY_ID) : undefined,
  );

  const events = (await db
    .select({
      id: learningEvents.id,
      runId: learningEvents.runId,
      mappingId: learningEvents.mappingId,
      companyId: learningEvents.companyId,
      extractedValueId: learningEvents.extractedValueId,
      sourceLabel: learningEvents.sourceLabel,
      previousState: learningEvents.previousState,
      newState: learningEvents.newState,
      createdAt: learningEvents.createdAt,
    })
    .from(learningEvents)
    .where(baseWhere)
    .orderBy(desc(learningEvents.createdAt))) as OverrideRow[];

  console.log(
    `[promote] ${events.length} override_applied events` +
      (COMPANY_ID !== null ? ` (company ${COMPANY_ID})` : "") +
      ` (apply=${APPLY}, min-evidence=${MIN_EVIDENCE})`,
  );

  // Group by mapping_id.
  const clusters = new Map<number, Cluster>();
  for (const ev of events) {
    if (ev.mappingId === null) continue;
    let c = clusters.get(ev.mappingId);
    if (!c) {
      c = {
        mappingId: ev.mappingId,
        companyId: ev.companyId,
        sourceLabel: ev.sourceLabel,
        runs: new Set(),
        latestRunId: ev.runId ?? 0,
        events: [],
        deltaRatios: [],
      };
      clusters.set(ev.mappingId, c);
    }
    if (ev.runId !== null) c.runs.add(ev.runId);
    if (ev.runId !== null && ev.runId > c.latestRunId) c.latestRunId = ev.runId;
    c.events.push(ev);

    // Compute delta ratio if both sides are numeric.
    const prev = extractNumeric(ev.previousState, "extractedValue");
    const next = extractNumeric(ev.newState, "analystOverride");
    if (prev !== null && next !== null && prev !== 0) {
      c.deltaRatios.push(next / prev);
    } else {
      c.deltaRatios.push(null);
    }
  }

  // Filter clusters that meet the evidence threshold.
  const eligible: Cluster[] = [];
  for (const c of clusters.values()) {
    if (c.runs.size >= MIN_EVIDENCE) eligible.push(c);
  }

  console.log(
    `[promote] ${clusters.size} clusters total, ${eligible.length} meet evidence threshold (≥ ${MIN_EVIDENCE} runs)`,
  );

  if (eligible.length === 0) {
    console.log("[promote] nothing to promote.");
    return;
  }

  // Load company names for readability.
  const companyIds = Array.from(
    new Set(eligible.map((c) => c.companyId).filter((x): x is number => x !== null)),
  );
  const companyRows = companyIds.length
    ? await db.select().from(companies).where(inArray(companies.id, companyIds))
    : [];
  const companyById = new Map(companyRows.map((r) => [r.id, r]));

  // Load current mapping state for confidence_score.
  const mappingIds = eligible.map((c) => c.mappingId);
  const mappingRows = await db
    .select()
    .from(fieldMappings)
    .where(inArray(fieldMappings.id, mappingIds));
  const mappingById = new Map(mappingRows.map((r) => [r.id, r]));

  // For each cluster, decide: promote or flag contradiction.
  let promoted = 0;
  let flagged = 0;
  let skipped = 0;

  for (const c of eligible) {
    const mapping = mappingById.get(c.mappingId);
    if (!mapping) {
      console.log(`  [skip] mapping ${c.mappingId} not found`);
      skipped++;
      continue;
    }

    const contradiction = isContradictory(c.deltaRatios);
    const companyName = c.companyId !== null ? companyById.get(c.companyId)?.ticker ?? "?" : "?";
    const header = `  [${c.mappingId}] ${companyName} "${c.sourceLabel ?? "?"}" — ${c.runs.size} distinct runs`;

    if (contradiction) {
      console.log(`${header} → CONTRADICTION (ratios: ${formatRatios(c.deltaRatios)})`);
      flagged++;

      if (APPLY) {
        await db
          .insert(learningEvents)
          .values({
            eventType: "lint_flagged",
            entityType: "field_mapping",
            entityId: c.mappingId,
            mappingId: c.mappingId,
            companyId: c.companyId,
            runId: c.latestRunId || null,
            sourceLabel: c.sourceLabel,
            previousState: { confidenceScore: mapping.confidenceScore },
            newState: { reason: "contradictory_overrides", ratios: c.deltaRatios },
            reason: "contradictory_overrides",
            trigger: "lint",
            actorType: "system",
            actorId: "promote-learning-events",
          })
          .onConflictDoNothing();
      }
      continue;
    }

    const oldConfidence = mapping.confidenceScore ?? 0.5;
    const newConfidence = Math.max(MIN_CONFIDENCE, oldConfidence - CONFIDENCE_STEP);
    const delta = newConfidence - oldConfidence;
    const newCorrectionCount = (mapping.correctionCount ?? 0) + c.runs.size;

    console.log(
      `${header} → promote: confidence ${oldConfidence.toFixed(2)} → ${newConfidence.toFixed(2)}, correction_count +${c.runs.size}`,
    );
    promoted++;

    if (APPLY) {
      // Idempotency guard: if we already wrote a confidence_updated
      // event for this (run, mapping, event_type) tuple, the unique
      // index short-circuits us.
      const inserted = await db
        .insert(learningEvents)
        .values({
          eventType: "confidence_updated",
          entityType: "field_mapping",
          entityId: c.mappingId,
          mappingId: c.mappingId,
          companyId: c.companyId,
          runId: c.latestRunId || null,
          sourceLabel: c.sourceLabel,
          previousState: {
            confidenceScore: oldConfidence,
            correctionCount: mapping.correctionCount,
          },
          newState: {
            confidenceScore: newConfidence,
            correctionCount: newCorrectionCount,
            confidenceDelta: delta,
            evidenceRuns: c.runs.size,
          },
          reason: "evidence_gated_promotion",
          trigger: "auto_merge",
          actorType: "system",
          actorId: "promote-learning-events",
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length === 0) {
        console.log("    (already promoted for this run — skipped)");
        continue;
      }

      await db
        .update(fieldMappings)
        .set({
          confidenceScore: newConfidence,
          correctionCount: newCorrectionCount,
          updatedAt: new Date(),
        })
        .where(eq(fieldMappings.id, c.mappingId));
    }
  }

  console.log(
    `[promote] done. promoted=${promoted} flagged=${flagged} skipped=${skipped} (apply=${APPLY})`,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractNumeric(state: unknown, key: string): number | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return isNaN(n) ? null : n;
}

/**
 * Detects contradictory override patterns on the same mapping. We bucket
 * the new/old ratios into coarse categories and flag when the cluster
 * spans more than one bucket — that means different runs were pushing
 * the value in different directions, which is not a repeatable
 * correction and should not feed back into shared memory.
 *
 * Buckets:
 *   - "down_10x"   → ratio in [0, 0.2)
 *   - "down_small" → ratio in [0.2, 0.9)
 *   - "sign_flip"  → ratio in [-1.1, -0.9]
 *   - "stable"     → ratio in [0.9, 1.1]   (no-op or tiny tweak)
 *   - "up_small"   → ratio in (1.1, 5.0]
 *   - "up_10x"     → ratio > 5.0
 *   - "other"      → anything else (including negative but not flip)
 */
function isContradictory(ratios: (number | null)[]): boolean {
  const buckets = new Set<string>();
  for (const r of ratios) {
    if (r === null) continue;
    buckets.add(bucketize(r));
  }
  // "stable" overlapping with an actionable bucket is not a contradiction —
  // it's just noise. But if the actionable buckets disagree, flag.
  buckets.delete("stable");
  return buckets.size > 1;
}

function bucketize(r: number): string {
  if (r >= -1.1 && r <= -0.9) return "sign_flip";
  if (r >= 0 && r < 0.2) return "down_10x";
  if (r >= 0.2 && r < 0.9) return "down_small";
  if (r >= 0.9 && r <= 1.1) return "stable";
  if (r > 1.1 && r <= 5.0) return "up_small";
  if (r > 5.0) return "up_10x";
  return "other";
}

function formatRatios(ratios: (number | null)[]): string {
  return ratios
    .map((r) => (r === null ? "—" : r.toFixed(2)))
    .join(", ");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
