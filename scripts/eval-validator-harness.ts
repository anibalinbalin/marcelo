/**
 * scripts/eval-validator-harness.ts
 *
 * Synthetic-corruption eval harness for the adversarial validator.
 *
 * Pulls known-good extractions from the DB, injects a set of corruption
 * types, runs each through runAdversarialValidation, and reports:
 *   - trigger rate (would shouldTriggerAdversarial have fired on this?)
 *   - catch rate (did runAdversarialValidation return needs_review or error?)
 *   - false-positive rate (clean runs classified as needs_review)
 *   - per-corruption-type precision/recall
 *   - LLM round-trip count per case
 *
 * This is W1.3 of docs/superpowers/plans/2026-04-13-hardening-plan.md.
 * Without measurements like these, adversarial-fidelity upgrades (Author-B,
 * Synthesizer, etc) are speculative — we don't know if current validator
 * catches real errors with acceptable noise.
 *
 * Usage:
 *   pnpm tsx scripts/eval-validator-harness.ts              # default runs
 *   pnpm tsx scripts/eval-validator-harness.ts 29 16 21 12  # specific runs
 *
 * Output: prints a markdown table to stdout. Pipe to a file if you want
 * to save the baseline.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import {
  runAdversarialValidation,
  shouldTriggerAdversarial,
  type ExtractedValueForValidation,
} from "../src/lib/validation/adversarial";

const DEFAULT_RUNS = [29, 16, 21, 12];

type CorruptionKind =
  | "clean"
  | "sign_flip"
  | "magnitude_1000x"
  | "decimal_shift"
  | "row_swap"
  | "zero_wipe";

const ALL_CORRUPTIONS: CorruptionKind[] = [
  "clean",
  "sign_flip",
  "magnitude_1000x",
  "decimal_shift",
  "row_swap",
  "zero_wipe",
];

// ── Corruption strategies ────────────────────────────────────────────────────

function applyCorruption(
  values: ExtractedValueForValidation[],
  kind: CorruptionKind
): { values: ExtractedValueForValidation[]; description: string } {
  if (kind === "clean") {
    return { values, description: "unmodified" };
  }

  const copy = values.map((v) => ({ ...v }));

  // Pick the first row with a parseable non-zero value — that's our victim
  const victimIdx = copy.findIndex((v) => {
    const n = parseFloat(v.extractedValue);
    return !isNaN(n) && n !== 0;
  });

  if (victimIdx === -1) {
    return { values: copy, description: "no non-zero value to corrupt" };
  }

  const victim = copy[victimIdx];
  const original = parseFloat(victim.extractedValue);

  switch (kind) {
    case "sign_flip": {
      copy[victimIdx] = { ...victim, extractedValue: String(-original) };
      return {
        values: copy,
        description: `flipped ${victim.sourceLabel}: ${original} -> ${-original}`,
      };
    }
    case "magnitude_1000x": {
      copy[victimIdx] = { ...victim, extractedValue: String(original * 1000) };
      return {
        values: copy,
        description: `×1000 on ${victim.sourceLabel}: ${original} -> ${original * 1000}`,
      };
    }
    case "decimal_shift": {
      copy[victimIdx] = { ...victim, extractedValue: String(original / 10) };
      return {
        values: copy,
        description: `÷10 on ${victim.sourceLabel}: ${original} -> ${original / 10}`,
      };
    }
    case "row_swap": {
      // Swap victim with next row that has a parseable value
      const partnerIdx = copy.findIndex((v, i) => {
        if (i === victimIdx) return false;
        const n = parseFloat(v.extractedValue);
        return !isNaN(n) && n !== original;
      });
      if (partnerIdx === -1) {
        return { values: copy, description: "no partner row to swap" };
      }
      const partner = copy[partnerIdx];
      copy[victimIdx] = { ...victim, extractedValue: partner.extractedValue };
      copy[partnerIdx] = { ...partner, extractedValue: victim.extractedValue };
      return {
        values: copy,
        description: `swapped "${victim.sourceLabel}" <-> "${partner.sourceLabel}"`,
      };
    }
    case "zero_wipe": {
      copy[victimIdx] = { ...victim, extractedValue: "0" };
      return {
        values: copy,
        description: `zeroed ${victim.sourceLabel} (was ${original})`,
      };
    }
    default:
      return { values: copy, description: "unknown corruption" };
  }
}

// ── DB loader ────────────────────────────────────────────────────────────────

type RawRow = {
  id: number;
  source_label: string;
  extracted_value: string;
  confidence: string | number;
  validation_status: string | null;
  validation_message: string | null;
  target_sheet: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlClient = any;

async function loadRunValues(
  sql: SqlClient,
  runId: number
): Promise<{
  company: string;
  quarter: string;
  values: ExtractedValueForValidation[];
}> {
  const meta = (await sql`
    select er.id, er.quarter, c.ticker
    from extraction_runs er
    left join companies c on c.id = er.company_id
    where er.id = ${runId}
    limit 1
  `) as Array<{ ticker: string | null; quarter: string }>;
  if (meta.length === 0) {
    throw new Error(`run ${runId} not found`);
  }

  const rows = (await sql`
    select
      ev.id,
      fm.source_label,
      fm.target_sheet,
      ev.extracted_value,
      ev.confidence,
      ev.validation_status,
      ev.validation_message
    from extracted_values ev
    join field_mappings fm on fm.id = ev.mapping_id
    where ev.run_id = ${runId}
    order by ev.id
  `) as unknown as RawRow[];

  const values: ExtractedValueForValidation[] = rows.map((r) => ({
    id: r.id,
    sourceLabel: r.source_label,
    extractedValue: r.extracted_value,
    confidence: typeof r.confidence === "string" ? parseFloat(r.confidence) : r.confidence,
    validationStatus: r.validation_status,
    validationMessage: r.validation_message,
  }));

  return {
    company: meta[0].ticker ?? "unknown",
    quarter: meta[0].quarter,
    values,
  };
}

// ── Eval runner ──────────────────────────────────────────────────────────────

type EvalResult = {
  runId: number;
  company: string;
  quarter: string;
  corruption: CorruptionKind;
  description: string;
  triggered: boolean; // what shouldTriggerAdversarial would have said
  status: "pass" | "needs_review" | "error";
  roundsNeeded: number;
  violations: number;
  judgeVoteCount: number;
  durationMs: number;
  errorMsg?: string;
};

async function evalCase(
  sql: SqlClient,
  runId: number,
  corruption: CorruptionKind
): Promise<EvalResult> {
  const { company, quarter, values: clean } = await loadRunValues(sql, runId);

  // Bump confidence of one row slightly low on clean + corrupted cases so
  // shouldTriggerAdversarial reports meaningfully; we still call
  // runAdversarialValidation directly below regardless of its answer, but
  // the "would it have triggered naturally?" signal is useful.
  const { values: corrupted, description } = applyCorruption(clean, corruption);

  const triggered = shouldTriggerAdversarial(corrupted);

  const started = Date.now();
  let result: Awaited<ReturnType<typeof runAdversarialValidation>>;
  try {
    result = await runAdversarialValidation(corrupted, "income");
  } catch (err) {
    return {
      runId,
      company,
      quarter,
      corruption,
      description,
      triggered,
      status: "error",
      roundsNeeded: 0,
      violations: 0,
      judgeVoteCount: 0,
      durationMs: Date.now() - started,
      errorMsg: err instanceof Error ? err.message : String(err),
    };
  }
  const durationMs = Date.now() - started;

  return {
    runId,
    company,
    quarter,
    corruption,
    description,
    triggered,
    status: result.status,
    roundsNeeded: result.roundsNeeded,
    violations: result.constraintViolations.length,
    judgeVoteCount: result.judgeVotes.length,
    durationMs,
  };
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printResultsTable(results: EvalResult[]): void {
  console.log(
    "\n| run | company | corruption | trigger? | status | violations | rounds | votes | duration | detail |"
  );
  console.log(
    "|-----|---------|------------|----------|--------|------------|--------|-------|----------|--------|"
  );
  for (const r of results) {
    const detail = r.errorMsg ? `ERROR: ${r.errorMsg}` : r.description;
    const status = r.status === "error" ? `❌ error` : r.status;
    console.log(
      `| ${r.runId} | ${r.company} | ${r.corruption} | ${r.triggered ? "yes" : "no"} | ${status} | ${r.violations} | ${r.roundsNeeded} | ${r.judgeVoteCount} | ${r.durationMs}ms | ${detail} |`
    );
  }
}

function printSummary(results: EvalResult[]): void {
  const byCorruption = new Map<CorruptionKind, EvalResult[]>();
  for (const r of results) {
    const list = byCorruption.get(r.corruption) ?? [];
    list.push(r);
    byCorruption.set(r.corruption, list);
  }

  console.log("\n\n## Summary — catch rate per corruption type");
  console.log("\n| corruption | n | caught (needs_review) | errors | pass | catch rate |");
  console.log("|------------|---|------------------------|--------|------|------------|");

  for (const kind of ALL_CORRUPTIONS) {
    const cases = byCorruption.get(kind) ?? [];
    if (cases.length === 0) continue;
    const caught = cases.filter((r) => r.status === "needs_review").length;
    const errors = cases.filter((r) => r.status === "error").length;
    const passed = cases.filter((r) => r.status === "pass").length;
    const rate = ((caught / cases.length) * 100).toFixed(0);
    console.log(
      `| ${kind} | ${cases.length} | ${caught} | ${errors} | ${passed} | ${rate}% |`
    );
  }

  // False-positive rate = clean cases that were flagged needs_review
  const clean = byCorruption.get("clean") ?? [];
  if (clean.length > 0) {
    const falsePos = clean.filter((r) => r.status === "needs_review").length;
    console.log(
      `\n**False positive rate on clean runs:** ${falsePos}/${clean.length} = ${((falsePos / clean.length) * 100).toFixed(0)}%`
    );
  }

  // Overall cost
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const totalVotes = results.reduce((s, r) => s + r.judgeVoteCount, 0);
  console.log(
    `\n**Total wall time:** ${(totalDuration / 1000).toFixed(1)}s across ${results.length} cases`
  );
  console.log(
    `**Total judge votes recorded:** ${totalVotes} (each vote = 1 Haiku round-trip; critic adds ~1 more per case with status≠pass)`
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argRuns = process.argv
    .slice(2)
    .map((s) => Number.parseInt(s, 10))
    .filter(Number.isFinite);
  const runs = argRuns.length > 0 ? argRuns : DEFAULT_RUNS;

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set in .env.local");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log(
    `# Adversarial validator eval — ${new Date().toISOString()}\n\nRuns: ${runs.join(", ")}\nCorruptions: ${ALL_CORRUPTIONS.join(", ")}\nStatement type: income (v1 assumption)\n`
  );

  const results: EvalResult[] = [];
  for (const runId of runs) {
    for (const corruption of ALL_CORRUPTIONS) {
      process.stderr.write(`  [${runId}/${corruption}]... `);
      try {
        const r = await evalCase(sql, runId, corruption);
        results.push(r);
        process.stderr.write(`${r.status} (${r.durationMs}ms)\n`);
      } catch (err) {
        process.stderr.write(
          `FAILED: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  printResultsTable(results);
  printSummary(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
