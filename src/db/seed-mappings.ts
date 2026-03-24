/**
 * Seed field mappings for BIMBO — maps BIVA PDF labels to PROJ sheet blue cells.
 * Based on benchmark results: PDF values are in full units, Excel in millions.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { fieldMappings } from "./schema";

const BIMBO_PROJ_MAPPINGS = [
  // Income Statement (Section [310000])
  { sourceSection: "[310000]", sourceLabel: "Ingresos", targetSheet: "PROJ", targetRow: 5, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Costo de ventas", targetSheet: "PROJ", targetRow: 7, valueTransform: "negate_divide_1000000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad bruta", targetSheet: "PROJ", targetRow: 9, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Gastos de venta", targetSheet: "PROJ", targetRow: 11, valueTransform: "negate_divide_1000000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) de operación", targetSheet: "PROJ", targetRow: 13, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Ingresos financieros", targetSheet: "PROJ", targetRow: 15, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Gastos financieros", targetSheet: "PROJ", targetRow: 16, valueTransform: "negate_divide_1000000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) antes de impuestos", targetSheet: "PROJ", targetRow: 29, valueTransform: "divide_1000000", validationSign: null },
  { sourceSection: "[310000]", sourceLabel: "Impuestos a la utilidad", targetSheet: "PROJ", targetRow: 31, valueTransform: "negate_divide_1000000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) neta", targetSheet: "PROJ", targetRow: 35, valueTransform: "divide_1000000", validationSign: null },
  { sourceSection: "[310000]", sourceLabel: "Participación no controladora en la utilidad", targetSheet: "PROJ", targetRow: 33, valueTransform: "negate_divide_1000000", validationSign: null },

  // Balance Sheet (Section [210000])
  { sourceSection: "[210000]", sourceLabel: "Efectivo y equivalentes de efectivo", targetSheet: "PROJ", targetRow: 42, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos circulantes", targetSheet: "PROJ", targetRow: 45, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos", targetSheet: "PROJ", targetRow: 55, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de pasivos circulantes", targetSheet: "PROJ", targetRow: 60, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de pasivos", targetSheet: "PROJ", targetRow: 70, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de capital contable", targetSheet: "PROJ", targetRow: 80, valueTransform: "divide_1000000", validationSign: "positive" },
];

async function seedMappings() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log("Seeding BIMBO field mappings...");

  const values = BIMBO_PROJ_MAPPINGS.map((m) => ({
    companyId: 1, // BIMBO
    colMode: "quarterly_offset" as const,
    sourceSection: m.sourceSection,
    sourceLabel: m.sourceLabel,
    targetSheet: m.targetSheet,
    targetRow: m.targetRow,
    targetColBase: "B",
    targetColStep: 1,
    baseQuarter: "1Q15",
    expectedCurrency: "MXN",
    valueTransform: m.valueTransform,
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(values).returning();
  console.log(`Seeded ${result.length} mappings for BIMBO`);
}

seedMappings()
  .then(() => { console.log("Done!"); process.exit(0); })
  .catch((err) => { console.error("Failed:", err); process.exit(1); });
