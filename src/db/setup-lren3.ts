/**
 * One-shot LREN3 (Lojas Renner) setup: create company, upload template, seed mappings.
 *
 * Source: Renner Planilhas e Fundamentos Excel (published by the company with quarterly data).
 * This is Excel-to-Excel extraction — no PDF needed.
 *
 * sourceSection = sheet name in source Excel ("Income Statement", "Balance Sheet")
 * sourceCol = column header in row 6 of source (e.g., "4Q25")
 * sourceLabel = English label in column B of source (exact match)
 *
 * Units: R$ mil (thousands). Model also uses thousands → no transform needed.
 * Base quarter: 1Q04 (column 3 in PROJ).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { readFileSync } from "fs";
import { companies, fieldMappings } from "./schema";

const TEMPLATE_PATH = "public/camila/LREN3 OK.xlsx";

const LREN3_MAPPINGS = [
  // ─── Income Statement (from "Income Statement" sheet in Planilhas) ───
  // PROJ [V] rows that Camila enters manually
  { sourceSection: "Income Statement", sourceLabel: "Gross Operating Revenues", targetRow: 3, valueTransform: null, validationSign: "positive" },
  { sourceSection: "Income Statement", sourceLabel: "Costs of Goods Sold", targetRow: 7, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Income Statement", sourceLabel: "Selling", targetRow: 11, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Income Statement", sourceLabel: "General and Administrative", targetRow: 12, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Income Statement", sourceLabel: "Depreciation and Amortization", targetRow: 13, valueTransform: null, validationSign: "negative" },
  { sourceSection: "Income Statement", sourceLabel: "Other Operating Income", targetRow: 15, valueTransform: null, validationSign: null },

  // ─── Balance Sheet (from "Balance Sheet" sheet in Planilhas) ───
  // PROJ [V] rows — BS labels are in column C of source
  { sourceSection: "Balance Sheet", sourceLabel: "Cash & Cash Equivalents", targetRow: 90, valueTransform: null, validationSign: "positive" },
  { sourceSection: "Balance Sheet", sourceLabel: "Short-Term Investments", targetRow: 91, valueTransform: null, validationSign: "positive" },
  { sourceSection: "Balance Sheet", sourceLabel: "Trade Accounts Receivable", targetRow: 92, valueTransform: null, validationSign: "positive" },
  { sourceSection: "Balance Sheet", sourceLabel: "Inventories", targetRow: 93, valueTransform: null, validationSign: "positive" },
  { sourceSection: "Balance Sheet", sourceLabel: "Total Assets", targetRow: 107, valueTransform: null, validationSign: "positive" },
];

async function setup() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  // 1. Create company
  console.log("Creating LREN3 company record...");
  const [company] = await db
    .insert(companies)
    .values({
      name: "Lojas Renner",
      ticker: "LREN3",
      sourceType: "excel",
    })
    .returning();
  console.log(`  Created company ID ${company.id}`);

  // 2. Upload template
  console.log("Uploading Excel template to Vercel Blob...");
  const templateBuffer = readFileSync(TEMPLATE_PATH);
  const blob = await put(
    `templates/${company.id}/LREN3_OK.xlsx`,
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

  // 4. Seed field mappings — sourceCol will be set per upload (e.g., "4Q25")
  // For now, seed with "4Q25" as the target column in the source Planilhas
  console.log("Seeding field mappings...");
  const mappingValues = LREN3_MAPPINGS.map((m) => ({
    companyId: company.id,
    colMode: "quarterly_offset" as const,
    sourceSection: m.sourceSection,
    sourceCol: "4Q25", // Updated each quarter when uploading a new Planilhas
    sourceLabel: m.sourceLabel,
    targetSheet: "PROJ",
    targetRow: m.targetRow,
    targetColBase: "C", // Col C = 1Q04 (col 3 in Excel, but targetColBase is letter)
    targetColStep: 1,
    baseQuarter: "1Q04",
    expectedCurrency: "BRL",
    valueTransform: m.valueTransform,
    validationSign: m.validationSign,
  }));

  const result = await db.insert(fieldMappings).values(mappingValues).returning();
  console.log(`  Seeded ${result.length} mappings`);

  console.log(`\nDone! LREN3 is company ID ${company.id}. Test extraction at /companies/${company.id}/upload`);
  console.log("Source file: Renner Planilhas e Fundamentos (6).xlsx");
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
