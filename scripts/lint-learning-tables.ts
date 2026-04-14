/**
 * scripts/lint-learning-tables.ts
 *
 * W3.2 lint pass. Scans the extraction-memory tables for health
 * signals and reports a human-readable punch list. Optionally writes
 * `lint_flagged` events into learning_events so downstream UI can
 * surface them.
 *
 * Checks:
 *
 *   1. orphan_aliases: concept_aliases rows whose concept_id no longer
 *      points at a canonical_concept (shouldn't happen with FK in place,
 *      but the check is cheap and catches drift from hand-written
 *      migrations).
 *
 *   2. unused_aliases: concept_aliases rows that have never been
 *      linked to an extracted_value via extracted_values.matched_alias_id.
 *      These accumulated during backfill and may represent noise we
 *      should prune.
 *
 *   3. stale_mappings: field_mappings where last_verified_at is NULL
 *      or older than STALE_DAYS. Either the mapping has never been
 *      reviewed, or no one has looked at it in a long time.
 *
 *   4. near_duplicate_aliases: different concept_aliases rows with the
 *      same normalized alias_text across different concepts. Either a
 *      data-entry bug or a genuine ambiguity — flag for human review.
 *
 *   5. stuck_mappings: field_mappings with correction_count >=
 *      CORRECTION_STUCK_THRESHOLD but confidence_score at or above
 *      CONFIDENCE_STUCK_FLOOR. Analysts keep overriding it but the
 *      promotion pipeline hasn't reacted. Usually means promotion is
 *      blocked by contradictions, or confidence update logic is broken.
 *
 * Usage:
 *   pnpm tsx scripts/lint-learning-tables.ts                # dry-run
 *   pnpm tsx scripts/lint-learning-tables.ts --apply        # write lint events
 *   pnpm tsx scripts/lint-learning-tables.ts --stale-days 60
 *
 * The script never deletes or mutates semantic memory. `--apply` only
 * writes `lint_flagged` events that surface the issue elsewhere.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import {
  canonicalConcepts,
  conceptAliases,
  extractedValues,
  fieldMappings,
  learningEvents,
} from "../src/db/schema";

// ── Args ─────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");
const STALE_DAYS = parseInt(argValue("--stale-days") ?? "30", 10);
const CORRECTION_STUCK_THRESHOLD = 3;
const CONFIDENCE_STUCK_FLOOR = 0.5;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

// ── Main ─────────────────────────────────────────────────────────────────────

type Finding = {
  kind: string;
  entityType: "field_mapping" | "concept_alias" | "canonical_concept";
  entityId: number;
  message: string;
};

async function main() {
  const neonSql = neon(process.env.DATABASE_URL!);
  const db = drizzle(neonSql);

  const findings: Finding[] = [];

  // ── 1. orphan_aliases ────────────────────────────────────────────────────
  {
    const orphans = await db
      .select({ id: conceptAliases.id, aliasText: conceptAliases.aliasText, conceptId: conceptAliases.conceptId })
      .from(conceptAliases)
      .leftJoin(canonicalConcepts, sql`${canonicalConcepts.id} = ${conceptAliases.conceptId}`)
      .where(sql`${canonicalConcepts.id} IS NULL`);
    for (const o of orphans) {
      findings.push({
        kind: "orphan_alias",
        entityType: "concept_alias",
        entityId: o.id,
        message: `alias "${o.aliasText}" points at missing concept ${o.conceptId}`,
      });
    }
  }

  // ── 2. unused_aliases ────────────────────────────────────────────────────
  {
    const unused = await db
      .select({
        id: conceptAliases.id,
        aliasText: conceptAliases.aliasText,
        conceptId: conceptAliases.conceptId,
      })
      .from(conceptAliases)
      .leftJoin(extractedValues, sql`${extractedValues.matchedAliasId} = ${conceptAliases.id}`)
      .where(sql`${extractedValues.id} IS NULL`);
    // Unused aliases are a soft signal — we report them as a single aggregate
    // finding rather than one per row, to keep the output scannable.
    if (unused.length > 0) {
      findings.push({
        kind: "unused_aliases_aggregate",
        entityType: "concept_alias",
        entityId: 0,
        message: `${unused.length} concept_aliases rows have never matched an extracted value`,
      });
    }
  }

  // ── 3. stale_mappings ────────────────────────────────────────────────────
  {
    const staleDate = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    const stale = await db
      .select({
        id: fieldMappings.id,
        sourceLabel: fieldMappings.sourceLabel,
        lastVerifiedAt: fieldMappings.lastVerifiedAt,
        companyId: fieldMappings.companyId,
      })
      .from(fieldMappings)
      .where(
        sql`${fieldMappings.isActive} = true AND (${fieldMappings.lastVerifiedAt} IS NULL OR ${fieldMappings.lastVerifiedAt} < ${staleDate})`,
      );
    for (const m of stale) {
      const age = m.lastVerifiedAt
        ? Math.floor((Date.now() - m.lastVerifiedAt.getTime()) / (24 * 60 * 60 * 1000))
        : null;
      findings.push({
        kind: "stale_mapping",
        entityType: "field_mapping",
        entityId: m.id,
        message: `"${m.sourceLabel}" (company ${m.companyId}) unverified ${age !== null ? `${age}d` : "ever"}`,
      });
    }
  }

  // ── 4. near_duplicate_aliases ────────────────────────────────────────────
  {
    // Find (alias_text normalized) tuples that appear across multiple
    // concept_ids. We do the normalization in SQL via lower+trim.
    const dupes = (await neonSql`
      SELECT lower(trim(alias_text)) AS norm_text,
             array_agg(DISTINCT concept_id) AS concept_ids,
             array_agg(id) AS alias_ids
      FROM concept_aliases
      GROUP BY lower(trim(alias_text))
      HAVING count(DISTINCT concept_id) > 1
    `) as Array<{ norm_text: string; concept_ids: number[]; alias_ids: number[] }>;
    for (const d of dupes) {
      findings.push({
        kind: "near_duplicate_alias",
        entityType: "concept_alias",
        entityId: d.alias_ids[0],
        message: `"${d.norm_text}" maps to ${d.concept_ids.length} different concepts (${d.concept_ids.join(", ")})`,
      });
    }
  }

  // ── 5. stuck_mappings ────────────────────────────────────────────────────
  {
    const stuck = await db
      .select({
        id: fieldMappings.id,
        sourceLabel: fieldMappings.sourceLabel,
        correctionCount: fieldMappings.correctionCount,
        confidenceScore: fieldMappings.confidenceScore,
        companyId: fieldMappings.companyId,
      })
      .from(fieldMappings)
      .where(
        sql`${fieldMappings.correctionCount} >= ${CORRECTION_STUCK_THRESHOLD} AND ${fieldMappings.confidenceScore} >= ${CONFIDENCE_STUCK_FLOOR}`,
      );
    for (const m of stuck) {
      findings.push({
        kind: "stuck_mapping",
        entityType: "field_mapping",
        entityId: m.id,
        message: `"${m.sourceLabel}" (company ${m.companyId}) corrected ${m.correctionCount} times but confidence still ${m.confidenceScore}`,
      });
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }

  console.log(`\n# Learning-tables lint (${new Date().toISOString()})`);
  console.log(`\nTotal findings: ${findings.length} (apply=${APPLY}, stale-days=${STALE_DAYS})`);

  for (const [kind, list] of byKind) {
    console.log(`\n## ${kind} (${list.length})`);
    for (const f of list.slice(0, 20)) {
      console.log(`  - [${f.entityType} ${f.entityId}] ${f.message}`);
    }
    if (list.length > 20) {
      console.log(`  ... ${list.length - 20} more`);
    }
  }

  // ── Optional: write lint_flagged events ──────────────────────────────────
  if (APPLY && findings.length > 0) {
    let written = 0;
    for (const f of findings) {
      // Skip the aggregate unused-alias finding — it's a report-only signal
      // with entityId=0, not a pointer at a real row.
      if (f.entityId === 0) continue;
      const result = await db
        .insert(learningEvents)
        .values({
          eventType: "lint_flagged",
          entityType: f.entityType,
          entityId: f.entityId,
          reason: f.kind,
          trigger: "lint",
          actorType: "system",
          actorId: "lint-learning-tables",
          previousState: null,
          newState: { message: f.message },
        })
        .onConflictDoNothing()
        .returning();
      if (result.length > 0) written++;
    }
    console.log(`\n[lint] wrote ${written} lint_flagged events`);
  }

  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
