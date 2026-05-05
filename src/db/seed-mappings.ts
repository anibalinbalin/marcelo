/**
 * Seed field mappings for BIMBO — maps BIVA PDF labels to PROJ + FAT sheet cells.
 * PROJ: structured BIVA sections ([310000], [210000]), values in full units → divide_1000000.
 * FAT: press release regional tables, values already in millions MXN → no transform.
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
  { sourceSection: "[310000]", sourceLabel: "Participación en la utilidad (pérdida) de asociadas y negocios conjuntos", targetSheet: "PROJ", targetRow: 29, valueTransform: "divide_1000000", validationSign: null },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) antes de impuestos", targetSheet: "PROJ", targetRow: 30, valueTransform: "divide_1000000", validationSign: null },
  { sourceSection: "[310000]", sourceLabel: "Impuestos a la utilidad", targetSheet: "PROJ", targetRow: 31, valueTransform: "negate_divide_1000000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) neta", targetSheet: "PROJ", targetRow: 35, valueTransform: "divide_1000000", validationSign: null },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) atribuible a la participación no controladora", targetSheet: "PROJ", targetRow: 33, valueTransform: "negate_divide_1000000", validationSign: null },

  // Balance Sheet (Section [210000])
  { sourceSection: "[210000]", sourceLabel: "Efectivo y equivalentes de efectivo", targetSheet: "PROJ", targetRow: 42, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos circulantes", targetSheet: "PROJ", targetRow: 45, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos", targetSheet: "PROJ", targetRow: 55, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de pasivos circulantes", targetSheet: "PROJ", targetRow: 60, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total pasivos", targetSheet: "PROJ", targetRow: 70, valueTransform: "divide_1000000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de capital contable", targetSheet: "PROJ", targetRow: 80, valueTransform: "divide_1000000", validationSign: "positive" },
];

// FAT sheet — regional breakdown from press release tables (already in millions MXN)
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

async function seedMappings() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log("Seeding BIMBO field mappings...");

  const projValues = BIMBO_PROJ_MAPPINGS.map((m) => ({
    companyId: 1,
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

  const fatValues = BIMBO_FAT_MAPPINGS.map((m) => ({
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

  const result = await db.insert(fieldMappings).values([...projValues, ...fatValues]).returning();
  const projCount = result.filter((r) => r.targetSheet === "PROJ").length;
  const fatCount = result.filter((r) => r.targetSheet === "FAT").length;
  console.log(`Seeded ${projCount} PROJ + ${fatCount} FAT = ${result.length} total mappings for BIMBO`);
}

seedMappings()
  .then(() => { console.log("Done!"); process.exit(0); })
  .catch((err) => { console.error("Failed:", err); process.exit(1); });
