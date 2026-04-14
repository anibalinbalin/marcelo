import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql: any = neon(process.env.DATABASE_URL!);
  const cols = (tab: string) => sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tab}
    ORDER BY ordinal_position
  `;

  for (const t of ["concept_aliases", "mapping_history", "learning_events", "field_mappings"]) {
    console.log(`\n=== ${t} ===`);
    const rows = await cols(t);
    for (const r of rows) {
      console.log(`  ${r.column_name.padEnd(28)} ${r.data_type.padEnd(28)} null=${r.is_nullable}`);
    }
  }

  // Check constraints/indexes
  console.log("\n=== constraints / indexes ===");
  const idx = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND (indexname LIKE '%learning_events%' OR indexname LIKE '%concept_aliases_concept%')
  `;
  for (const r of idx) console.log(`  ${r.indexname}: ${r.indexdef}`);

  // Self-FK on field_mappings.superseded_by
  const fks = await sql`
    SELECT con.conname, pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'field_mappings' AND con.contype = 'f'
  `;
  console.log("\n=== field_mappings FKs ===");
  for (const r of fks) console.log(`  ${r.conname}: ${r.pg_get_constraintdef}`);
}
main().catch(e => { console.error(e); process.exit(1); });
