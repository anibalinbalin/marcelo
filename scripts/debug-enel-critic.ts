/**
 * Debug ENEL LLM critic false positive rate.
 *
 * Loads ENEL run 12 unmodified, calls runAdversarialValidation 10 times,
 * reports status + critic assessment distribution. Used to narrow down
 * whether the ENEL ~33% FPR comes from:
 *
 *   1. runCritic non-determinism (temperature too high), OR
 *   2. Judge panel voting B/AB on legitimately clean data, OR
 *   3. Something legitimately suspicious in the ENEL extraction that the
 *      critic is flagging inconsistently.
 *
 * Context: docs/eval-baseline-2026-04-14.md §"Stability run" showed that
 * 1 of 3 clean ENEL repeats returned needs_review across the 2026-04-14
 * stability eval. Single-run evals (4 companies × 1 sample) report 0%
 * FPR because ENEL is 1/4 and non-ENEL runs structurally never trigger
 * the LLM path.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import {
  runCritic,
  type ExtractedValueForValidation,
} from "../src/lib/validation/adversarial";

async function main() {
  const sql: any = neon(process.env.DATABASE_URL!);

  const rows = await sql`
    SELECT ev.id, fm.source_label, ev.extracted_value, ev.confidence,
           ev.validation_status, ev.validation_message
    FROM extracted_values ev
    JOIN field_mappings fm ON fm.id = ev.mapping_id
    WHERE ev.run_id = 12
    ORDER BY ev.id
  `;

  const values: ExtractedValueForValidation[] = rows.map((r: any) => ({
    id: r.id,
    sourceLabel: r.source_label,
    extractedValue: r.extracted_value,
    confidence: typeof r.confidence === "string" ? parseFloat(r.confidence) : r.confidence,
    validationStatus: r.validation_status,
    validationMessage: r.validation_message,
  }));

  console.log(`Loaded ${values.length} ENEL run 12 values.\n`);

  const ITERATIONS = 5;
  console.log(`Running critic ${ITERATIONS}× on unmodified data, logging its raw output to see what it's flagging...\n`);

  for (let i = 1; i <= ITERATIONS; i++) {
    process.stderr.write(`[${i}/${ITERATIONS}] `);
    try {
      const critic = await runCritic(values, []);
      process.stderr.write(`assessment=${critic.overallAssessment} issues=${critic.issues.length} arithErrors=${critic.arithmeticErrors.length}\n`);
      console.log(`\n### Iteration ${i}`);
      console.log(`- overallAssessment: **${critic.overallAssessment}**`);
      console.log(`- issues: ${critic.issues.length}`);
      for (const issue of critic.issues) {
        console.log(`  - ${issue.label}: ${issue.currentValue} → ${issue.suggestedValue ?? "?"}`);
        console.log(`    problem: ${issue.problem}`);
      }
      console.log(`- arithmeticErrors: ${critic.arithmeticErrors.length}`);
      for (const err of critic.arithmeticErrors) {
        console.log(`  - ${err}`);
      }
    } catch (err) {
      process.stderr.write(`FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
