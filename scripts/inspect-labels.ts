import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql: any = neon(process.env.DATABASE_URL!);
  for (const run_id of [29, 16, 21, 12]) {
    const meta = await sql`SELECT er.id, c.name FROM extraction_runs er JOIN companies c ON er.company_id = c.id WHERE er.id = ${run_id}`;
    const rows = await sql`
      SELECT fm.source_label, ev.extracted_value, ev.confidence
      FROM extracted_values ev
      LEFT JOIN field_mappings fm ON ev.mapping_id = fm.id
      WHERE ev.run_id = ${run_id} AND fm.source_label IS NOT NULL
      ORDER BY fm.source_label
    `;
    console.log(`\n=== RUN ${run_id} ${meta[0]?.name} (${rows.length} rows) ===`);
    for (const r of rows) console.log(`  ${r.source_label.padEnd(70)} ${r.extracted_value}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
