/**
 * Adversarial validation using autoreason-style debate.
 *
 * When basic validation produces warnings, this module runs a multi-agent
 * tournament to verify extraction correctness:
 *
 * 1. Critic agent reviews extraction + source, identifies issues
 * 2. Revision agent proposes corrections
 * 3. Judge panel (3 agents) votes on which version is correct
 *
 * The convergence mechanism: if the original (A) wins 2 consecutive rounds,
 * validation passes. If corrections (B/AB) win, we flag for analyst review.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  getConstraintsForStatement,
  labelMatches,
  MIN_TOLERANCE_ABSOLUTE,
} from "./constraints";

// ── Schemas for structured LLM output ────────────────────────────────────────
// generateText with Output.object + Zod gives us guaranteed JSON shape.
// The previous manual JSON.parse approach crashed on ~12.5% of runs in
// the first eval baseline (docs/eval-baseline-2026-04-13.md) when the
// model returned prose-wrapped JSON.

const CriticOutputSchema = z.object({
  issues: z.array(
    z.object({
      label: z.string(),
      currentValue: z.string(),
      problem: z.string(),
      suggestedValue: z.string().optional(),
    })
  ),
  arithmeticErrors: z.array(z.string()),
  overallAssessment: z.enum(["correct", "minor_issues", "major_issues"]),
});

const JudgeVoteSchema = z.object({
  vote: z.enum(["A", "B", "AB"]),
  reasoning: z.string(),
});

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedValueForValidation {
  id: number;
  sourceLabel: string;
  extractedValue: string;
  confidence: number;
  validationStatus: string | null;
  validationMessage: string | null;
}

export interface AdversarialResult {
  status: "pass" | "needs_review" | "error";
  message: string;
  constraintViolations: ConstraintViolation[];
  judgeVotes: JudgeVote[];
  roundsNeeded: number;
}

interface ConstraintViolation {
  constraintName: string;
  expected: number;
  actual: number;
  difference: number;
  severity: "warning" | "error";
}

interface JudgeVote {
  judgeId: number;
  vote: "A" | "B" | "AB";
  reasoning: string;
}

interface CriticOutput {
  issues: {
    label: string;
    currentValue: string;
    problem: string;
    suggestedValue?: string;
  }[];
  arithmeticErrors: string[];
  overallAssessment: "correct" | "minor_issues" | "major_issues";
}

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_ROUNDS = 3;
const CONSECUTIVE_WINS_TO_PASS = 2;

function getOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
}

// ── Rule-Based Constraint Checking ───────────────────────────────────────────

/**
 * Check arithmetic constraints against extracted values.
 * This is the fast path - no LLM needed.
 */
export function checkArithmeticConstraints(
  values: ExtractedValueForValidation[],
  statementType: "income" | "balance" | "cashflow"
): ConstraintViolation[] {
  const constraints = getConstraintsForStatement(statementType);
  const violations: ConstraintViolation[] = [];

  for (const constraint of constraints) {
    // Find values that match constraint terms
    let sum = 0;
    let termsFound = 0;

    for (const term of constraint.terms) {
      const match = values.find(v => labelMatches(v.sourceLabel, term.labels));
      if (match) {
        const numValue = parseFloat(match.extractedValue);
        if (!isNaN(numValue)) {
          // flow encodes accounting semantics so we don't depend on the
          // source's sign convention (CENT stores costs negative, other
          // companies store them positive; both should satisfy the same
          // constraint definition).
          const contribution =
            term.flow === "inflow"
              ? Math.abs(numValue)
              : term.flow === "outflow"
              ? -Math.abs(numValue)
              : numValue;
          sum += contribution;
          termsFound++;
        }
      }
    }

    // Find the result value
    const result = values.find(v => labelMatches(v.sourceLabel, constraint.resultLabel));
    if (!result || termsFound < 2) continue; // Not enough data to check

    const resultValue = parseFloat(result.extractedValue);
    if (isNaN(resultValue)) continue;

    const difference = Math.abs(sum - resultValue);
    // Percentage-based tolerance with an absolute floor — see
    // ArithmeticConstraint.toleranceFraction docs. Prevents both
    // "1 unit absolute on a 3M revenue" false positives and "1% of 0"
    // divide-by-noise false negatives.
    const scale = Math.max(Math.abs(sum), Math.abs(resultValue));
    const threshold = Math.max(
      constraint.toleranceFraction * scale,
      MIN_TOLERANCE_ABSOLUTE,
    );
    if (difference > threshold) {
      violations.push({
        constraintName: constraint.name,
        expected: sum,
        actual: resultValue,
        difference,
        severity: difference > threshold * 10 ? "error" : "warning",
      });
    }
  }

  return violations;
}

// ── LLM-Based Adversarial Validation ─────────────────────────────────────────

/**
 * Run critic agent to identify potential issues.
 */
async function runCritic(
  values: ExtractedValueForValidation[],
  constraintViolations: ConstraintViolation[]
): Promise<CriticOutput> {
  const openrouter = getOpenRouter();

  const valuesTable = values
    .map(v => `- ${v.sourceLabel}: ${v.extractedValue} (confidence: ${(v.confidence * 100).toFixed(0)}%)`)
    .join("\n");

  const violationsText = constraintViolations.length > 0
    ? `\nArithmetic constraint violations detected:\n${constraintViolations.map(v =>
        `- ${v.constraintName}: expected ${v.expected}, got ${v.actual} (diff: ${v.difference})`
      ).join("\n")}`
    : "";

  const prompt = `You are a financial data validation critic. Review these extracted values for errors.

EXTRACTED VALUES:
${valuesTable}
${violationsText}

Analyze for:
1. Arithmetic consistency (do sums match totals?)
2. Sign errors (expenses should be negative, revenues positive)
3. Magnitude errors (values off by factor of 1000?)
4. Label mismatches (value assigned to wrong row?)

For each issue, populate label, currentValue, problem (one sentence),
and optionally suggestedValue. arithmeticErrors is a list of plain-text
descriptions of any sum/total mismatches you spot. overallAssessment is
correct, minor_issues, or major_issues.`;

  const result = await generateText({
    model: openrouter("anthropic/claude-haiku-4.5"),
    output: Output.object({ schema: CriticOutputSchema }),
    messages: [{ role: "user", content: prompt }],
  });

  return result.output;
}

/**
 * Run judge panel to vote on extraction correctness.
 * Each judge emits a single vote (A/B/AB); tallied via weighted plurality
 * with a bias toward A (the original extraction).
 */
async function runJudgePanel(
  values: ExtractedValueForValidation[],
  criticOutput: CriticOutput,
  constraintViolations: ConstraintViolation[]
): Promise<JudgeVote[]> {
  const openrouter = getOpenRouter();

  const valuesTable = values
    .map(v => `${v.sourceLabel}: ${v.extractedValue}`)
    .join("\n");

  const issuesTable = criticOutput.issues.length > 0
    ? criticOutput.issues
        .map(i => `${i.label}: ${i.currentValue} → ${i.suggestedValue || "?"} (${i.problem})`)
        .join("\n")
    : "No issues identified";

  const prompt = `You are a financial data validation judge. Two versions of extracted data exist:

VERSION A (Original extraction):
${valuesTable}

VERSION B (Critic's corrections):
${issuesTable}

Arithmetic violations: ${constraintViolations.length > 0 ? constraintViolations.map(v => v.constraintName).join(", ") : "None detected"}

Vote for the most accurate version:
- A: Original extraction is correct, critic found false positives
- B: Critic's corrections are needed
- AB: Partial corrections needed (some critic suggestions valid, some not)

Provide a one-sentence reasoning.`;

  // Run 3 judges in parallel
  const judgePromises = [1, 2, 3].map(async (judgeId) => {
    const result = await generateText({
      model: openrouter("anthropic/claude-haiku-4.5"),
      output: Output.object({ schema: JudgeVoteSchema }),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3 + judgeId * 0.1, // Slight variation for diversity
    });

    return { judgeId, ...result.output };
  });

  const results = await Promise.all(judgePromises);
  return results;
}

/**
 * Tally judge votes via weighted plurality (not true Borda — judges emit a
 * single vote, not a ranking). A=3, AB=2, B=1, biased toward the original
 * extraction on ties.
 */
function tallyWeightedPlurality(votes: JudgeVote[]): "A" | "B" | "AB" {
  const scores = { A: 0, B: 0, AB: 0 };
  const points = { A: 3, AB: 2, B: 1 };

  for (const vote of votes) {
    scores[vote.vote] += points[vote.vote];
  }

  if (scores.A >= scores.B && scores.A >= scores.AB) return "A";
  if (scores.AB >= scores.B) return "AB";
  return "B";
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Run adversarial validation on flagged extractions.
 *
 * @param values - Extracted values with warnings from basic validation
 * @param statementType - Type of financial statement (for constraint selection)
 * @returns Validation result with pass/needs_review status
 */
export async function runAdversarialValidation(
  values: ExtractedValueForValidation[],
  statementType: "income" | "balance" | "cashflow" = "income"
): Promise<AdversarialResult> {
  // Step 1: Rule-based constraint checking (fast, no LLM)
  const constraintViolations = checkArithmeticConstraints(values, statementType);

  // If no constraint violations and all values have high confidence, pass immediately
  const allHighConfidence = values.every(v => v.confidence >= 0.9);
  if (constraintViolations.length === 0 && allHighConfidence) {
    return {
      status: "pass",
      message: "All arithmetic constraints satisfied, high confidence",
      constraintViolations: [],
      judgeVotes: [],
      roundsNeeded: 0,
    };
  }

  // Step 2: Run critic to identify potential issues
  let criticOutput: CriticOutput;
  try {
    criticOutput = await runCritic(values, constraintViolations);
  } catch (error) {
    return {
      status: "error",
      message: `Critic failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      constraintViolations,
      judgeVotes: [],
      roundsNeeded: 0,
    };
  }

  // If critic says "correct" and no constraint violations, pass
  if (criticOutput.overallAssessment === "correct" && constraintViolations.length === 0) {
    return {
      status: "pass",
      message: "Critic validated extraction as correct",
      constraintViolations: [],
      judgeVotes: [],
      roundsNeeded: 1,
    };
  }

  // Step 3: Run judge panel for adversarial debate
  let consecutiveAWins = 0;
  let allVotes: JudgeVote[] = [];
  let roundsNeeded = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    roundsNeeded++;

    try {
      const roundVotes = await runJudgePanel(values, criticOutput, constraintViolations);
      allVotes = [...allVotes, ...roundVotes];

      const winner = tallyWeightedPlurality(roundVotes);

      if (winner === "A") {
        consecutiveAWins++;
        if (consecutiveAWins >= CONSECUTIVE_WINS_TO_PASS) {
          return {
            status: "pass",
            message: `Original extraction validated after ${roundsNeeded} round(s)`,
            constraintViolations,
            judgeVotes: allVotes,
            roundsNeeded,
          };
        }
      } else {
        consecutiveAWins = 0;
      }

      // If B or AB wins, flag for review
      if (winner === "B" || winner === "AB") {
        return {
          status: "needs_review",
          message: `Judges recommend corrections (${winner} won round ${round + 1})`,
          constraintViolations,
          judgeVotes: allVotes,
          roundsNeeded,
        };
      }
    } catch (error) {
      return {
        status: "error",
        message: `Judge panel failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        constraintViolations,
        judgeVotes: allVotes,
        roundsNeeded,
      };
    }
  }

  // Max rounds reached without convergence
  return {
    status: "needs_review",
    message: "Max rounds reached without convergence",
    constraintViolations,
    judgeVotes: allVotes,
    roundsNeeded,
  };
}

/**
 * Should adversarial validation be triggered?
 *
 * Always runs the rule-based arithmetic constraint check first (it's free —
 * no LLM). If any constraint is violated, trigger regardless of basic
 * validation status. Otherwise fall back to the warning/low-confidence
 * gate so the LLM path doesn't run on clean healthy extractions.
 *
 * Before W1.4 this function only looked at warnings/confidence, which meant
 * clean healthy runs (REGIONAL, NTCO3 — all rows confidence=1.0, no
 * warnings) never entered the adversarial path even when corrupted. See
 * docs/eval-baseline-2026-04-13.md for the baseline that motivated this.
 */
export function shouldTriggerAdversarial(
  values: ExtractedValueForValidation[],
  statementType: "income" | "balance" | "cashflow" = "income"
): boolean {
  if (values.length < 3) return false;

  const violations = checkArithmeticConstraints(values, statementType);
  if (violations.length > 0) return true;

  const hasWarnings = values.some(v => v.validationStatus === "warning");
  const hasLowConfidence = values.some(v => v.confidence < 0.85);

  return hasWarnings || hasLowConfidence;
}
