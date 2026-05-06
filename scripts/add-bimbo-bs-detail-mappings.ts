/**
 * Add BIMBO PROJ Balance Sheet detail mappings (rows 63-91).
 * These target non-black-formula rows in the BS section (theme 9 and red cells).
 * Black-formula rows (structural totals) are preserved by writeback-bimbo.ts.
 *
 * BIVA labels are standardized taxonomy — same across all BIVA-reporting companies.
 */
import { readFileSync } from "fs";
const envContent = readFileSync(".env.local", "utf8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { fieldMappings } from "../src/db/schema";

const BIMBO_BS_DETAIL_MAPPINGS = [
  // Current Assets detail (theme 9 rows — writable)
  { sourceLabel: "Clientes y otras cuentas por cobrar", targetRow: 63, validationSign: "positive" },
  { sourceLabel: "Inventarios", targetRow: 64, validationSign: "positive" },
  // Row 65 "Other current" — no single BIVA label matches; skip for now

  // Non-Current Assets detail
  { sourceLabel: "Propiedades, planta y equipo", targetRow: 69, validationSign: "positive" },
  { sourceLabel: "Crédito mercantil", targetRow: 76, validationSign: "positive" },
  { sourceLabel: "Activos intangibles distintos al crédito mercantil", targetRow: 76, validationSign: null }, // fallback label
  // Row 77 "Others NCA" — aggregate, skip

  // Current Liabilities detail
  { sourceLabel: "Proveedores y otras cuentas por pagar a corto plazo", targetRow: 83, validationSign: "positive" },
  { sourceLabel: "Otros pasivos financieros a corto plazo", targetRow: 82, validationSign: "positive" },

  // Non-Current Liabilities detail (red rows — projections → overwrite with actuals)
  { sourceLabel: "Otros pasivos financieros a largo plazo", targetRow: 88, validationSign: "positive" },
  { sourceLabel: "Pasivos por impuestos diferidos", targetRow: 90, validationSign: "positive" },
];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log("Adding BIMBO BS detail mappings...");

  // Deduplicate: row 76 has two potential labels — keep first only
  const seen = new Set<number>();
  const unique = BIMBO_BS_DETAIL_MAPPINGS.filter(m => {
    if (seen.has(m.targetRow)) return false;
    seen.add(m.targetRow);
    return true;
  });

  const values = unique.map(m => ({
    companyId: 1,
    colMode: "quarterly_offset" as const,
    sourceSection: "[210000]",
    sourceLabel: m.sourceLabel,
    targetSheet: "PROJ",
    targetRow: m.targetRow,
    targetColBase: "B",
    targetColStep: 1,
    baseQuarter: "1Q15",
    expectedCurrency: "MXN",
    valueTransform: "divide_1000000",
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(values).returning();
  console.log(`Added ${result.length} BS detail mappings:`);
  for (const r of result) {
    console.log(`  ID ${r.id}: row ${r.targetRow} ← "${r.sourceLabel}"`);
  }
}

main()
  .then(() => { console.log("Done!"); process.exit(0); })
  .catch((err) => { console.error("Failed:", err); process.exit(1); });
