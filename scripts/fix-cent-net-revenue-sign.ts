import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql: any = neon(process.env.DATABASE_URL!);

  const before = await sql`
    SELECT fm.id, c.name AS company, fm.source_label, fm.validation_sign, fm.confidence_score AS confidence
    FROM field_mappings fm
    JOIN companies c ON c.id = fm.company_id
    WHERE c.name ILIKE '%cent%'
      AND fm.is_active = true
      AND fm.source_label ILIKE '%revenue%'
    ORDER BY fm.id
  `;
  console.log("BEFORE (CENT revenue-ish mappings):");
  for (const r of before) {
    console.log(
      `  id=${r.id}  sign=${r.validation_sign ?? "NULL"}  conf=${r.confidence}  label="${r.source_label}"`
    );
  }

  const updated = await sql`
    UPDATE field_mappings
    SET validation_sign = 'positive'
    WHERE id IN (
      SELECT fm.id
      FROM field_mappings fm
      JOIN companies c ON c.id = fm.company_id
      WHERE c.name ILIKE '%cent%'
        AND fm.is_active = true
        AND fm.source_label ILIKE 'net revenue%'
        AND (fm.validation_sign IS NULL OR fm.validation_sign = '')
    )
    RETURNING id, source_label, validation_sign
  `;
  console.log("\nUPDATED:");
  for (const r of updated) {
    console.log(`  id=${r.id}  sign=${r.validation_sign}  label="${r.source_label}"`);
  }
  if (updated.length === 0) console.log("  (no rows updated)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
