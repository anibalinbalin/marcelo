import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { checkArithmeticConstraints, type ExtractedValueForValidation } from "../src/lib/validation/adversarial";
import { INCOME_STATEMENT_CONSTRAINTS, labelMatches } from "../src/lib/validation/constraints";

function trace(values: ExtractedValueForValidation[]) {
  for (const c of INCOME_STATEMENT_CONSTRAINTS) {
    console.log(`\n--- ${c.name} ---`);
    for (const t of c.terms) {
      const match = values.find(v => labelMatches(v.sourceLabel, t.labels));
      console.log(`  term [${t.labels}] coef=${t.coefficient} -> ${match ? `${match.sourceLabel} = ${match.extractedValue}` : "NO MATCH"}`);
    }
    const result = values.find(v => labelMatches(v.sourceLabel, c.resultLabel));
    console.log(`  result [${c.resultLabel}] -> ${result ? `${result.sourceLabel} = ${result.extractedValue}` : "NO MATCH"}`);
  }
}

async function main() {
  const sql: any = neon(process.env.DATABASE_URL!);
  for (const run_id of [29]) {
    const rows = await sql`
      SELECT ev.id, fm.source_label, ev.extracted_value, ev.confidence, ev.validation_status, ev.validation_message
      FROM extracted_values ev
      LEFT JOIN field_mappings fm ON ev.mapping_id = fm.id
      WHERE ev.run_id = ${run_id} AND fm.source_label IS NOT NULL
    `;
    const values: ExtractedValueForValidation[] = rows.map((r: any) => ({
      id: r.id,
      sourceLabel: r.source_label,
      extractedValue: String(r.extracted_value),
      confidence: Number(r.confidence ?? 1),
      validationStatus: r.validation_status,
      validationMessage: r.validation_message,
    }));
    console.log(`\n=== RUN ${run_id} (${values.length} rows, row order as returned by DB) ===`);
    for (const v of values) console.log(`  ${v.sourceLabel.padEnd(70)} ${v.extractedValue}`);
    trace(values);
    const violations = checkArithmeticConstraints(values, "income");
    console.log(`\nViolations (${violations.length}):`);
    for (const v of violations) console.log(JSON.stringify(v, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
