/**
 * One-shot BANREGIO setup: create company, upload template, seed field mappings.
 *
 * Banregio's PDF has image-based financial tables → uses vision extraction.
 * sourceSection format: "vision:<page1>,<page2>" tells the pipeline which pages to OCR.
 *
 * Page layout (1-indexed):
 *   33-34: Balance Sheet (Assets on 33, Liabilities/Equity on 34)
 *   36:    Income Statement Trimestral (quarterly) + Indicadores CNBV
 *
 * Units: millones de pesos (millions). Model also uses millions → no transform needed.
 * Base quarter: 1Q19 (column B).
 *
 * Usage: npx tsx src/db/setup-banregio.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { readFileSync } from "fs";
import { companies, fieldMappings } from "./schema";

const TEMPLATE_PATH = "public/camila/RA MM ok.xlsx";

// Vision extracts Spanish labels from the PDF. We match them to PROJ rows.
// The vision model returns the last column (4T25) as values[4] (0-indexed).
const BANREGIO_MAPPINGS = [
  // ─── Income Statement (page 36 = IS Trimestral) ───
  // sourceCol "4" = last column (4T25) in the 5-column quarterly table
  { sourceSection: "vision:36", sourceLabel: "Ingresos por intereses", targetSheet: "PROJ", targetRow: 6, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:36", sourceLabel: "Gastos por intereses", targetSheet: "PROJ", targetRow: 7, sourceCol: "4", valueTransform: "negate", validationSign: "negative" },
  { sourceSection: "vision:36", sourceLabel: "Margen financiero", targetSheet: "PROJ", targetRow: 5, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:36", sourceLabel: "Estimación preventiva para riesgos crediticios", targetSheet: "PROJ", targetRow: 9, sourceCol: "4", valueTransform: "negate", validationSign: "negative" },
  { sourceSection: "vision:36", sourceLabel: "Gastos de Operación", targetSheet: "PROJ", targetRow: 12, sourceCol: "4", valueTransform: "negate", validationSign: "negative" },
  { sourceSection: "vision:36", sourceLabel: "Resultado de la operación", targetSheet: "PROJ", targetRow: 14, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:36", sourceLabel: "I.s.r. y p.t.u. causados", targetSheet: "PROJ", targetRow: 16, sourceCol: "4", valueTransform: "negate", validationSign: "negative" },
  { sourceSection: "vision:36", sourceLabel: "Resultado neto", targetSheet: "PROJ", targetRow: 20, sourceCol: "4", valueTransform: null, validationSign: "positive" },

  // ─── Balance Sheet (pages 33-34) ───
  // sourceCol "4" = last column (4T25)
  { sourceSection: "vision:33,34", sourceLabel: "Efectivo y Equivalentes de Efectivo", targetSheet: "PROJ", targetRow: 29, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:33,34", sourceLabel: "Inversiones en Instrumentos Financieros", targetSheet: "PROJ", targetRow: 30, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:33,34", sourceLabel: "Instrumentos Financieros Derivados", targetSheet: "PROJ", targetRow: 31, sourceCol: "4", valueTransform: null, validationSign: null },
  { sourceSection: "vision:33,34", sourceLabel: "Estimacion preventiva para riesgos crediticios", targetSheet: "PROJ", targetRow: 42, sourceCol: "4", valueTransform: "negate", validationSign: "negative" },
  { sourceSection: "vision:33,34", sourceLabel: "TOTAL ACTIVO", targetSheet: "PROJ", targetRow: 28, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:33,34", sourceLabel: "Captación tradicional", targetSheet: "PROJ", targetRow: 52, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:33,34", sourceLabel: "TOTAL PASIVO", targetSheet: "PROJ", targetRow: 51, sourceCol: "4", valueTransform: null, validationSign: "positive" },
  { sourceSection: "vision:33,34", sourceLabel: "TOTAL CAPITAL CONTABLE", targetSheet: "PROJ", targetRow: 67, sourceCol: "4", valueTransform: null, validationSign: "positive" },
];

async function setup() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  // 1. Create company
  console.log("Creating BANREGIO company record...");
  const [company] = await db
    .insert(companies)
    .values({
      name: "Banregio Grupo Financiero",
      ticker: "REGIONAL",
      sourceType: "pdf",
    })
    .returning();
  console.log(`  Created company ID ${company.id}`);

  // 2. Upload template
  console.log("Uploading Excel template to Vercel Blob...");
  const templateBuffer = readFileSync(TEMPLATE_PATH);
  const blob = await put(
    `templates/${company.id}/RA_MM_ok.xlsx`,
    templateBuffer,
    { access: "public", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  );
  console.log(`  Uploaded: ${blob.url}`);

  // 3. Update company with template URL
  await db
    .update(companies)
    .set({ modelTemplateBlobUrl: blob.url })
    .where(eq(companies.id, company.id));
  console.log("  Updated company with template URL");

  // 4. Seed field mappings
  console.log("Seeding field mappings...");
  const mappingValues = BANREGIO_MAPPINGS.map((m) => ({
    companyId: company.id,
    colMode: "quarterly_offset" as const,
    sourceSection: m.sourceSection,
    sourceCol: m.sourceCol,
    sourceLabel: m.sourceLabel,
    targetSheet: m.targetSheet,
    targetRow: m.targetRow,
    targetColBase: "B",
    targetColStep: 1,
    baseQuarter: "1Q19",
    expectedCurrency: "MXN",
    valueTransform: m.valueTransform,
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(mappingValues).returning();
  console.log(`  Seeded ${result.length} mappings`);

  console.log(`\nDone! BANREGIO is company ID ${company.id}. Test extraction at /companies/${company.id}/upload`);
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
