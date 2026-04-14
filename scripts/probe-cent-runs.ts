import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT r.id, r.status, r.quarter, r.created_at, c.ticker
    FROM extraction_runs r
    JOIN companies c ON c.id = r.company_id
    WHERE c.ticker = 'CENT' AND r.status = 'approved'
    ORDER BY r.id DESC LIMIT 5
  `;
  console.log(rows);
}
main();
