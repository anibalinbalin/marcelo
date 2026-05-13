/**
 * One-shot GRUMA setup: create company, upload template, seed field mappings.
 *
 * Usage: npx tsx src/db/setup-gruma.ts
 * Requires: DATABASE_URL, BLOB_READ_WRITE_TOKEN in env (loads .env.local)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { readFileSync } from "fs";
import { companies, fieldMappings } from "./schema";

const TEMPLATE_PATH = "public/camila/Gruma_Fundamenta 1Q26.xlsx";

const GRUMA_PROJ_MAPPINGS = [
  // ── Income Statement [310000] ──
  { sourceSection: "[310000]", sourceLabel: "Ingresos", targetRow: 3, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Costo de ventas", targetRow: 5, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad bruta", targetRow: 6, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Gastos de venta", targetRow: 10, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Gastos de administración", targetRow: 11, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Otros ingresos", targetRow: 12, valueTransform: "divide_1000", validationSign: null },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) de operación", targetRow: 14, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Ingresos financieros", targetRow: 18, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Gastos financieros", targetRow: 19, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) antes de impuestos", targetRow: 23, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[310000]", sourceLabel: "Impuestos a la utilidad", targetRow: 24, valueTransform: "negate_divide_1000", validationSign: "negative" },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) atribuible a la participación no controladora", targetRow: 26, valueTransform: "negate_divide_1000", validationSign: null },
  { sourceSection: "[310000]", sourceLabel: "Utilidad (pérdida) atribuible a la participación controladora", targetRow: 27, valueTransform: "divide_1000", validationSign: "positive" },

  // ── Balance Sheet [210000] ──
  { sourceSection: "[210000]", sourceLabel: "Efectivo y equivalentes de efectivo", targetRow: 56, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Clientes y otras cuentas por cobrar", targetRow: 57, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Inventarios", targetRow: 59, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos circulantes", targetRow: 63, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Propiedades, planta y equipo", targetRow: 67, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Inversiones registradas por método de participación", targetRow: 70, valueTransform: "divide_1000", validationSign: null },
  { sourceSection: "[210000]", sourceLabel: "Total de activos no circulantes", targetRow: 72, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de activos", targetRow: 73, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Otros pasivos financieros a corto plazo", targetRow: 75, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Proveedores y otras cuentas por pagar a corto plazo", targetRow: 76, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de pasivos circulantes", targetRow: 80, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Otros pasivos financieros a largo plazo", targetRow: 82, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Pasivo por impuestos diferidos", targetRow: 83, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total de pasivos a Largo plazo", targetRow: 85, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Participación no controladora", targetRow: 87, valueTransform: "divide_1000", validationSign: null },
  { sourceSection: "[210000]", sourceLabel: "Total de la participación controladora", targetRow: 88, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[210000]", sourceLabel: "Total pasivos", targetRow: 90, valueTransform: "divide_1000", validationSign: "positive" },

  // ── Cash Flow [520000] ──
  { sourceSection: "[520000]", sourceLabel: "Flujos de efectivo netos procedentes de (utilizados en) actividades de operación", targetRow: 102, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[520000]", sourceLabel: "Compras de propiedades, planta y equipo", targetRow: 105, valueTransform: "divide_1000", validationSign: "positive" },
  { sourceSection: "[520000]", sourceLabel: "Flujos de efectivo netos procedentes de (utilizados en) actividades de inversión", targetRow: 106, valueTransform: "divide_1000", validationSign: null },
  { sourceSection: "[520000]", sourceLabel: "Flujos de efectivo netos procedentes de (utilizados en) actividades de financiación", targetRow: 125, valueTransform: "divide_1000", validationSign: null },
  { sourceSection: "[520000]", sourceLabel: "Gastos de depreciación y amortización", targetRow: 98, valueTransform: "divide_1000", validationSign: "positive" },

  // ── Shares outstanding [700000] ──
  { sourceSection: "[700000]", sourceLabel: "Numero de acciones en circulación", targetRow: 30, valueTransform: "divide_1000000", validationSign: "positive" },
];

async function setup() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log("Creating GRUMA company record...");
  const [company] = await db
    .insert(companies)
    .values({
      name: "GRUMA, S.A.B. de C.V.",
      ticker: "GRUMAB",
      sourceType: "excel",
    })
    .returning();
  console.log(`  Created company ID ${company.id}`);

  console.log("Uploading Excel template to Vercel Blob...");
  const templateBuffer = readFileSync(TEMPLATE_PATH);
  const blob = await put(
    `templates/${company.id}/Gruma_Fundamenta_1Q26.xlsx`,
    templateBuffer,
    { access: "public", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  );
  console.log(`  Uploaded: ${blob.url}`);

  await db
    .update(companies)
    .set({ modelTemplateBlobUrl: blob.url })
    .where(eq(companies.id, company.id));
  console.log("  Updated company with template URL");

  console.log("Seeding field mappings...");
  const mappingValues = GRUMA_PROJ_MAPPINGS.map((m) => ({
    companyId: company.id,
    colMode: "quarterly_offset" as const,
    sourceSection: m.sourceSection,
    sourceLabel: m.sourceLabel,
    targetSheet: "PROJ",
    targetRow: m.targetRow,
    targetColBase: "B",
    targetColStep: 1,
    baseQuarter: "1Q16",
    expectedCurrency: "USD",
    valueTransform: m.valueTransform,
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(mappingValues).returning();
  console.log(`  Seeded ${result.length} mappings`);

  console.log(`\nDone! GRUMA is company ID ${company.id}. Test extraction at /companies/${company.id}/upload`);
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
