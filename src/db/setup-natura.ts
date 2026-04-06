/**
 * One-shot NATURA setup: create company, upload template, seed mappings.
 *
 * Source: Natura Planilha de Resultados Excel ("Full model" sheet, quarterly data).
 * Excel-to-Excel extraction. Source labels are in column A (English).
 * sourceCol = "Q4-25" (matches row 2 header in Full model).
 *
 * Units: R$ millions. Model (PROJ sheet) also uses millions → no transform.
 * PROJ labels are in column B, quarters start at column C (1T15).
 * Base quarter: 1Q15.
 * 4T25 = column 46 (1-indexed) in PROJ.
 *
 * Note: PROJ rows are mostly formulas from FAT. We write values directly to PROJ,
 * overriding formulas. This gives Camila the actual numbers in the right cells.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { readFileSync } from "fs";
import { companies, fieldMappings } from "./schema";

const TEMPLATE_PATH = "public/camila/NATURA (limpo).xlsx";

// Source: "Full model" sheet in Natura Planilha de Resultados
// Labels are in column A (row[0]), data for Q4-25 at column index 9
const NATURA_MAPPINGS = [
  // ─── Income Statement ───
  { sourceSection: "Full model", sourceLabel: "Gross revenues", targetRow: 3, valueTransform: null, validationSign: "positive" },
  { sourceSection: "Full model", sourceLabel: "Deductions", targetRow: 4, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Full model", sourceLabel: "COGS", targetRow: 7, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Full model", sourceLabel: "Selling expenses", targetRow: 13, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Full model", sourceLabel: "G&A expenses", targetRow: 15, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Full model", sourceLabel: "D&A", targetRow: 17, valueTransform: "negate", validationSign: "negative" },
  { sourceSection: "Full model", sourceLabel: "Other expenses  revenues", targetRow: 19, valueTransform: null, validationSign: null },
  { sourceSection: "Full model", sourceLabel: "Net financials", targetRow: 26, valueTransform: null, validationSign: null },
  { sourceSection: "Full model", sourceLabel: "Interest revenues", targetRow: 27, valueTransform: null, validationSign: "positive" },
  { sourceSection: "Full model", sourceLabel: "Interest expenses", targetRow: 28, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Full model", sourceLabel: "Lease expenses", targetRow: 29, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Full model", sourceLabel: "Tax expenses", targetRow: 34, valueTransform: null, validationSign: null },
  { sourceSection: "Full model", sourceLabel: "Discontinued operations", targetRow: 40, valueTransform: null, validationSign: null },
  { sourceSection: "Full model", sourceLabel: "Net income", targetRow: 42, valueTransform: null, validationSign: null },
];

async function setup() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log("Creating NATURA company record...");
  const [company] = await db
    .insert(companies)
    .values({
      name: "Natura &Co",
      ticker: "NTCO3",
      sourceType: "excel",
    })
    .returning();
  console.log(`  Created company ID ${company.id}`);

  console.log("Uploading Excel template to Vercel Blob...");
  const templateBuffer = readFileSync(TEMPLATE_PATH);
  const blob = await put(
    `templates/${company.id}/NATURA_limpo.xlsx`,
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
  const mappingValues = NATURA_MAPPINGS.map((m) => ({
    companyId: company.id,
    colMode: "quarterly_offset" as const,
    sourceSection: m.sourceSection,
    sourceCol: "Q4-25",
    sourceLabel: m.sourceLabel,
    targetSheet: "PROJ",
    targetRow: m.targetRow,
    targetColBase: "C",
    targetColStep: 1,
    baseQuarter: "1Q15",
    expectedCurrency: "BRL",
    valueTransform: m.valueTransform,
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(mappingValues).returning();
  console.log(`  Seeded ${result.length} mappings`);

  console.log(`\nDone! NATURA is company ID ${company.id}. Test extraction at /companies/${company.id}/upload`);
  console.log("Source file: Natura Planilha de Resultados (downloaded from ri.natura.com.br)");
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
