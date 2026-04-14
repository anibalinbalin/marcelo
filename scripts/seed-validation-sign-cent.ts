/**
 * Populate validation_sign='positive' on CENT balance-sheet and gross-revenue
 * rows that are unambiguously always-positive.
 *
 * Scoped narrowly: excludes Investments (id=150) because it's legitimately 0
 * for companies without non-current investments, and marking it positive
 * would reintroduce the zero-value warning that was fixed in e696394.
 *
 * Excludes Shareholders' equity (id=161), Deferred income and social
 * contribution (id=149), and all CENT IS rows below gross profit (net income,
 * financial result, income tax, etc.) because those are signed or can be
 * negative in loss years. Those need analyst judgment.
 *
 * Rows populated: Gross revenue + 15 balance sheet positives. Follows the
 * same pattern as scripts/fix-cent-net-revenue-sign.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const SAFE_POSITIVE_IDS = [
  128, // Gross revenue
  143, // Cash and cash equivalents
  144, // Contas a receber
  145, // Inventory
  146, // Recoverable taxes
  148, // Long-term receivables
  151, // Property and equipment
  152, // Intangible
  153, // Total assets
  154, // Suppliers
  156, // Tax liabilities
  157, // Tax installment payment
  158, // Dividends payable
  159, // Tax installment
  160, // Provisions
  162, // Total liabilities and shareholders' equity
];

async function main() {
  const sql: any = neon(process.env.DATABASE_URL!);

  const before = await sql`
    SELECT fm.id, fm.source_label, fm.validation_sign
    FROM field_mappings fm
    WHERE fm.id = ANY(${SAFE_POSITIVE_IDS})
    ORDER BY fm.id
  `;
  console.log("BEFORE:");
  for (const r of before) {
    console.log(`  id=${r.id} sign=${r.validation_sign ?? "NULL"} label="${r.source_label}"`);
  }

  const updated = await sql`
    UPDATE field_mappings
    SET validation_sign = 'positive'
    WHERE id = ANY(${SAFE_POSITIVE_IDS})
      AND (validation_sign IS NULL OR validation_sign = '')
    RETURNING id, source_label, validation_sign
  `;
  console.log("\nUPDATED (" + updated.length + " rows):");
  for (const r of updated) {
    console.log(`  id=${r.id} sign=${r.validation_sign} label="${r.source_label}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
