/**
 * One-shot: add BIMBO FAT regional mappings to the database.
 * Source: press release tables (Ventas Netas, Utilidad Bruta, etc.)
 * Target: FAT sheet rows with absolute values (overwrite forecast formulas).
 *
 * Run: npx tsx scripts/add-bimbo-fat-mappings.ts
 */
import { readFileSync } from "fs";
const envContent = readFileSync(".env.local", "utf8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import { fieldMappings } from "../src/db/schema";

const BIMBO_FAT_MAPPINGS = [
  // México
  { sourceLabel: "Ventas Netas|México", targetRow: 23, validationSign: "positive" },
  { sourceLabel: "Utilidad Bruta|México", targetRow: 27, validationSign: "positive" },
  { sourceLabel: "Utilidad de Operación|México", targetRow: 33, validationSign: "positive" },
  { sourceLabel: "UAFIDA Ajustada|México", targetRow: 38, validationSign: "positive" },
  // US & Canada (Norteamérica)
  { sourceLabel: "Ventas Netas|Norteamérica", targetRow: 49, validationSign: "positive" },
  { sourceLabel: "Utilidad Bruta|Norteamérica", targetRow: 53, validationSign: "positive" },
  { sourceLabel: "Utilidad de Operación|Norteamérica", targetRow: 59, validationSign: null },
  { sourceLabel: "UAFIDA Ajustada|Norteamérica", targetRow: 64, validationSign: "positive" },
  // EAA
  { sourceLabel: "Ventas Netas|EAA", targetRow: 77, validationSign: "positive" },
  { sourceLabel: "Utilidad Bruta|EAA", targetRow: 81, validationSign: "positive" },
  { sourceLabel: "Utilidad de Operación|EAA", targetRow: 87, validationSign: null },
  { sourceLabel: "UAFIDA Ajustada|EAA", targetRow: 92, validationSign: "positive" },
  // Latin America
  { sourceLabel: "Ventas Netas|Latinoamérica", targetRow: 105, validationSign: "positive" },
  { sourceLabel: "Utilidad Bruta|Latinoamérica", targetRow: 108, validationSign: "positive" },
  { sourceLabel: "Utilidad de Operación|Latinoamérica", targetRow: 114, validationSign: null },
  { sourceLabel: "UAFIDA Ajustada|Latinoamérica", targetRow: 119, validationSign: null },
];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  // Check for existing FAT mappings
  const existing = await db
    .select()
    .from(fieldMappings)
    .where(and(eq(fieldMappings.companyId, 1), eq(fieldMappings.targetSheet, "FAT")));

  if (existing.length > 0) {
    console.log(`⚠ ${existing.length} BIMBO FAT mappings already exist. Skipping.`);
    return;
  }

  const values = BIMBO_FAT_MAPPINGS.map((m) => ({
    companyId: 1,
    colMode: "quarterly_offset" as const,
    sourceSection: "press_release",
    sourceLabel: m.sourceLabel,
    targetSheet: "FAT",
    targetRow: m.targetRow,
    targetColBase: "B",
    targetColStep: 1,
    baseQuarter: "1Q15",
    expectedCurrency: "MXN",
    valueTransform: null,
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(values).returning();
  console.log(`Seeded ${result.length} FAT mappings for BIMBO`);
  for (const r of result) {
    console.log(`  id=${r.id} FAT R${r.targetRow} ← ${r.sourceLabel}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
