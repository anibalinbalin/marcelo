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
 *   pnpm tsx scripts/eval-validator-harness.ts --stability 12 3   # run 12 × 3 repeats
 *
 * Stability mode: repeats a single run N times and reports per-corruption
 * variance. Used to filter LLM critic non-determinism out of aggregate
 * catch-rate metrics. See docs/eval-baseline-2026-04-14.md §4 for rationale.
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
import {
  runValidation as runBasicValidation,
  type ValidationInput,
} from "../src/lib/validation/engine";
import {
  getConstraintsForStatement,
  labelMatches,
  type ArithmeticConstraint,
} from "../src/lib/validation/constraints";

const INCOME_CONSTRAINTS = getConstraintsForStatement("income");

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

/**
 * Try to find a row whose label participates in any arithmetic constraint
 * (either as a term or as the result). Corrupting a constraint-adjacent row
 * lets the harness measure what the validator can actually catch via its
 * real mechanism, rather than reflecting "harness picked an uncovered row"
 * luck. See docs/eval-baseline-2026-04-13-post-w1-7.md for the rationale.
 */
function pickConstrainedVictim(
  values: ExtractedValueForValidation[],
  constraints: ArithmeticConstraint[]
): number {
  const patterns: string[] = [];
  for (const c of constraints) {
    for (const t of c.terms) patterns.push(t.labels);
    patterns.push(c.resultLabel);
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const n = parseFloat(v.extractedValue);
    if (isNaN(n) || n === 0) continue;
    if (patterns.some((p) => labelMatches(v.sourceLabel, p))) return i;
  }
  return -1;
}

type CorruptionTarget = "constrained" | "uncovered";

function applyCorruption(
  values: ExtractedValueForValidation[],
  kind: CorruptionKind,
  constraints: ArithmeticConstraint[]
): {
  values: ExtractedValueForValidation[];
  description: string;
  target: CorruptionTarget;
} {
  if (kind === "clean") {
    return { values, description: "unmodified", target: "constrained" };
  }

  const copy = values.map((v) => ({ ...v }));

  // Prefer constraint-adjacent victims so we measure validator capability,
  // not coverage luck. Fall back to first-non-zero if no constrained row
  // exists in this run's extracted values.
  let victimIdx = pickConstrainedVictim(copy, constraints);
  let target: CorruptionTarget = "constrained";
  if (victimIdx === -1) {
    victimIdx = copy.findIndex((v) => {
      const n = parseFloat(v.extractedValue);
      return !isNaN(n) && n !== 0;
    });
    target = "uncovered";
  }

  if (victimIdx === -1) {
    return {
      values: copy,
      description: "no non-zero value to corrupt",
      target,
    };
  }

  const victim = copy[victimIdx];
  const original = parseFloat(victim.extractedValue);

  switch (kind) {
    case "sign_flip": {
      copy[victimIdx] = { ...victim, extractedValue: String(-original) };
      return {
        values: copy,
        description: `flipped ${victim.sourceLabel}: ${original} -> ${-original}`,
        target,
      };
    }
    case "magnitude_1000x": {
      copy[victimIdx] = { ...victim, extractedValue: String(original * 1000) };
      return {
        values: copy,
        description: `×1000 on ${victim.sourceLabel}: ${original} -> ${original * 1000}`,
        target,
      };
    }
    case "decimal_shift": {
      copy[victimIdx] = { ...victim, extractedValue: String(original / 10) };
      return {
        values: copy,
        description: `÷10 on ${victim.sourceLabel}: ${original} -> ${original / 10}`,
        target,
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
        return { values: copy, description: "no partner row to swap", target };
      }
      const partner = copy[partnerIdx];
      copy[victimIdx] = { ...victim, extractedValue: partner.extractedValue };
      copy[partnerIdx] = { ...partner, extractedValue: victim.extractedValue };
      return {
        values: copy,
        description: `swapped "${victim.sourceLabel}" <-> "${partner.sourceLabel}"`,
        target,
      };
    }
    case "zero_wipe": {
      copy[victimIdx] = { ...victim, extractedValue: "0" };
      return {
        values: copy,
        description: `zeroed ${victim.sourceLabel} (was ${original})`,
        target,
      };
    }
    default:
      return { values: copy, description: "unknown corruption", target };
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
  validation_sign: string | null;
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
  signByValueId: Map<number, string | null>;
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
      fm.validation_sign,
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

  const signByValueId = new Map<number, string | null>();
  for (const r of rows) signByValueId.set(r.id, r.validation_sign);

  return {
    company: meta[0].ticker ?? "unknown",
    quarter: meta[0].quarter,
    values,
    signByValueId,
  };
}

// ── Eval runner ──────────────────────────────────────────────────────────────

type EvalResult = {
  runId: number;
  company: string;
  quarter: string;
  corruption: CorruptionKind;
  target: CorruptionTarget;
  description: string;
  triggered: boolean; // what shouldTriggerAdversarial would have said
  basicStatus: "pass" | "warning" | "fail";
  adversarialStatus: "pass" | "needs_review" | "error";
  /** End-user outcome: basic fail OR adversarial needs_review/error → caught */
  caught: boolean;
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
  const { company, quarter, values: clean, signByValueId } = await loadRunValues(
    sql,
    runId
  );

  const { values: corrupted, description, target } = applyCorruption(
    clean,
    corruption,
    INCOME_CONSTRAINTS
  );

  // Run basic validator first — this is what Camila's pipeline does before
  // handing off to the adversarial layer. Sign flips, NaN, and confidence
  // thresholds get caught here regardless of the LLM path.
  const basicInputs: ValidationInput[] = corrupted.map((v) => ({
    id: v.id,
    extractedValue: v.extractedValue,
    confidence: v.confidence,
    validationSign: signByValueId.get(v.id) ?? null,
    sourceLabel: v.sourceLabel,
  }));
  const basicResults = runBasicValidation(basicInputs);
  // Aggregate basic status = worst among rows (fail > warning > pass)
  const basicStatus: "pass" | "warning" | "fail" = basicResults.some((r) => r.status === "fail")
    ? "fail"
    : basicResults.some((r) => r.status === "warning")
      ? "warning"
      : "pass";

  const triggered = shouldTriggerAdversarial(corrupted);

  const started = Date.now();
  let result: Awaited<ReturnType<typeof runAdversarialValidation>>;
  try {
    result = await runAdversarialValidation(corrupted, "income");
  } catch (err) {
    const caught = basicStatus === "fail";
    return {
      runId,
      company,
      quarter,
      corruption,
      target,
      description,
      triggered,
      basicStatus,
      adversarialStatus: "error",
      caught,
      roundsNeeded: 0,
      violations: 0,
      judgeVoteCount: 0,
      durationMs: Date.now() - started,
      errorMsg: err instanceof Error ? err.message : String(err),
    };
  }
  const durationMs = Date.now() - started;

  // Caught means the end user would have seen the corruption flagged.
  // Basic fail is a hard catch; adversarial needs_review is a soft catch;
  // adversarial error is treated as uncaught because it leaves the value
  // in "pass" state in prod.
  const caught =
    basicStatus === "fail" ||
    result.status === "needs_review" ||
    result.status === "error";

  return {
    runId,
    company,
    quarter,
    corruption,
    target,
    description,
    triggered,
    basicStatus,
    adversarialStatus: result.status,
    caught,
    roundsNeeded: result.roundsNeeded,
    violations: result.constraintViolations.length,
    judgeVoteCount: result.judgeVotes.length,
    durationMs,
  };
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printResultsTable(results: EvalResult[]): void {
  console.log(
    "\n| run | company | corruption | target | trigger? | basic | adv | caught | violations | rounds | votes | duration | detail |"
  );
  console.log(
    "|-----|---------|------------|--------|----------|-------|-----|--------|------------|--------|-------|----------|--------|"
  );
  for (const r of results) {
    const detail = r.errorMsg ? `ERROR: ${r.errorMsg}` : r.description;
    const adv = r.adversarialStatus === "error" ? `❌ error` : r.adversarialStatus;
    const caughtMark = r.caught ? "✅" : "·";
    console.log(
      `| ${r.runId} | ${r.company} | ${r.corruption} | ${r.target} | ${r.triggered ? "yes" : "no"} | ${r.basicStatus} | ${adv} | ${caughtMark} | ${r.violations} | ${r.roundsNeeded} | ${r.judgeVoteCount} | ${r.durationMs}ms | ${detail} |`
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

  console.log("\n\n## Summary — catch rate per corruption type (end-user visible)");
  console.log("\n| corruption | n | caught | via basic | via adv | pass | catch rate |");
  console.log("|------------|---|--------|-----------|---------|------|------------|");

  for (const kind of ALL_CORRUPTIONS) {
    const cases = byCorruption.get(kind) ?? [];
    if (cases.length === 0) continue;
    const caught = cases.filter((r) => r.caught).length;
    const viaBasic = cases.filter((r) => r.basicStatus === "fail").length;
    const viaAdv = cases.filter(
      (r) => r.basicStatus !== "fail" &&
        (r.adversarialStatus === "needs_review" || r.adversarialStatus === "error")
    ).length;
    const passed = cases.filter((r) => !r.caught).length;
    const rate = ((caught / cases.length) * 100).toFixed(0);
    console.log(
      `| ${kind} | ${cases.length} | ${caught} | ${viaBasic} | ${viaAdv} | ${passed} | ${rate}% |`
    );
  }

  console.log("\n## Summary — catch rate by corruption target");
  console.log("\n| target | n | caught | pass | catch rate |");
  console.log("|--------|---|--------|------|------------|");
  for (const target of ["constrained", "uncovered"] as const) {
    const cases = results.filter((r) => r.target === target && r.corruption !== "clean");
    if (cases.length === 0) continue;
    const caught = cases.filter((r) => r.caught).length;
    const passed = cases.filter((r) => !r.caught).length;
    const rate = ((caught / cases.length) * 100).toFixed(0);
    console.log(
      `| ${target} | ${cases.length} | ${caught} | ${passed} | ${rate}% |`
    );
  }

  // False-positive rate = clean cases that would be flagged
  const clean = byCorruption.get("clean") ?? [];
  if (clean.length > 0) {
    const falsePos = clean.filter((r) => r.caught).length;
    console.log(
      `\n**False positive rate on clean runs:** ${falsePos}/${clean.length} = ${((falsePos / clean.length) * 100).toFixed(0)}%`
    );
  }
}

function printStabilityReport(
  results: EvalResult[],
  runId: number,
  repeat: number
): void {
  const company = results[0]?.company ?? `run ${runId}`;
  console.log(
    `\n\n## Stability report — ${company} run ${runId} × ${repeat} repeats`
  );
  console.log(
    "\nEach corruption was applied ${repeat} times to the same run. If catches are non-deterministic (LLM critic variance), this table shows it."
      .replace("${repeat}", String(repeat))
  );
  console.log("\n| corruption | catches | rate | basic always? | adv variance |");
  console.log("|------------|---------|------|---------------|--------------|");

  for (const kind of ALL_CORRUPTIONS) {
    const cases = results.filter((r) => r.corruption === kind);
    if (cases.length === 0) continue;
    const caught = cases.filter((r) => r.caught).length;
    const rate = ((caught / cases.length) * 100).toFixed(0);
    const allBasicFail = cases.every((r) => r.basicStatus === "fail");
    const basicMarker = allBasicFail
      ? "yes (stable)"
      : cases.some((r) => r.basicStatus === "fail")
        ? "partial"
        : "no";
    const advStatuses = new Set(cases.map((r) => r.adversarialStatus));
    const advVariance = advStatuses.size > 1 ? `flaky (${[...advStatuses].join("/")})` : [...advStatuses][0];
    console.log(
      `| ${kind} | ${caught}/${cases.length} | ${rate}% | ${basicMarker} | ${advVariance} |`
    );
  }

  // Overall stability: how many corruptions have 100% catch across all repeats?
  const stable: CorruptionKind[] = [];
  const flaky: CorruptionKind[] = [];
  const neverCaught: CorruptionKind[] = [];
  for (const kind of ALL_CORRUPTIONS) {
    if (kind === "clean") continue;
    const cases = results.filter((r) => r.corruption === kind);
    if (cases.length === 0) continue;
    const caught = cases.filter((r) => r.caught).length;
    if (caught === cases.length) stable.push(kind);
    else if (caught === 0) neverCaught.push(kind);
    else flaky.push(kind);
  }
  console.log(
    `\n**Stable catches (every repeat):** ${stable.length > 0 ? stable.join(", ") : "none"}`
  );
  console.log(
    `**Flaky catches (varies run-to-run):** ${flaky.length > 0 ? flaky.join(", ") : "none"}`
  );
  console.log(
    `**Never caught:** ${neverCaught.length > 0 ? neverCaught.join(", ") : "none"}`
  );

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
  const args = process.argv.slice(2);

  // --stability RUN_ID REPEAT mode
  const stabilityIdx = args.indexOf("--stability");
  const stabilityMode = stabilityIdx !== -1;
  let stabilityRunId = 0;
  let stabilityRepeat = 3;
  if (stabilityMode) {
    stabilityRunId = Number.parseInt(args[stabilityIdx + 1] ?? "", 10);
    stabilityRepeat = Number.parseInt(args[stabilityIdx + 2] ?? "3", 10);
    if (!Number.isFinite(stabilityRunId) || stabilityRunId <= 0) {
      console.error("Usage: --stability RUN_ID [REPEAT_COUNT=3]");
      process.exit(1);
    }
    if (!Number.isFinite(stabilityRepeat) || stabilityRepeat <= 0) {
      stabilityRepeat = 3;
    }
  }

  const argRuns = args
    .filter((s) => s !== "--stability")
    .map((s) => Number.parseInt(s, 10))
    .filter(Number.isFinite);
  const runs = stabilityMode
    ? Array.from({ length: stabilityRepeat }, () => stabilityRunId)
    : argRuns.length > 0
      ? argRuns
      : DEFAULT_RUNS;

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set in .env.local");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  const header = stabilityMode
    ? `# Adversarial validator stability eval — ${new Date().toISOString()}\n\nTarget: run ${stabilityRunId} × ${stabilityRepeat} repeats\nCorruptions: ${ALL_CORRUPTIONS.join(", ")}\nStatement type: income (v1 assumption)\n`
    : `# Adversarial validator eval — ${new Date().toISOString()}\n\nRuns: ${runs.join(", ")}\nCorruptions: ${ALL_CORRUPTIONS.join(", ")}\nStatement type: income (v1 assumption)\n`;
  console.log(header);

  const results: EvalResult[] = [];
  let repeatIdx = 0;
  for (const runId of runs) {
    repeatIdx++;
    for (const corruption of ALL_CORRUPTIONS) {
      const label = stabilityMode
        ? `  [${runId}#${repeatIdx}/${corruption}]... `
        : `  [${runId}/${corruption}]... `;
      process.stderr.write(label);
      try {
        const r = await evalCase(sql, runId, corruption);
        results.push(r);
        process.stderr.write(`${r.caught ? "caught" : "miss"} basic=${r.basicStatus} adv=${r.adversarialStatus} (${r.durationMs}ms)\n`);
      } catch (err) {
        process.stderr.write(
          `FAILED: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  if (stabilityMode) {
    printStabilityReport(results, stabilityRunId, stabilityRepeat);
  } else {
    printResultsTable(results);
    printSummary(results);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
