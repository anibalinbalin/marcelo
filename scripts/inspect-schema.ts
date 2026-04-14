import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql: any = neon(process.env.DATABASE_URL!);
  // Check if field_mappings.superseded_by has any populated values
  const supersededCount = await sql`SELECT COUNT(*)::int as c FROM field_mappings WHERE superseded_by IS NOT NULL`;
  console.log("field_mappings.superseded_by populated rows:", supersededCount[0].c);

  // Check concept_aliases for duplicates that would break a unique constraint
  const dupes = await sql`
    SELECT concept_id, alias_text, source_company_id, COUNT(*)::int as c
    FROM concept_aliases
    GROUP BY concept_id, alias_text, source_company_id
    HAVING COUNT(*) > 1
  `;
  console.log("concept_aliases duplicates that would block unique constraint:", dupes.length);
  if (dupes.length > 0) console.log(dupes);

  // Total rows in each table
  for (const t of ["canonical_concepts", "concept_aliases", "field_mappings", "mapping_history", "extracted_values", "extraction_runs"]) {
    const r = await sql.unsafe(`SELECT COUNT(*)::int as c FROM ${t}`);
    console.log(`${t}:`, r[0].c);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
