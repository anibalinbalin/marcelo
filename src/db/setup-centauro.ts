/**
 * CENTAURO (CENT, company_id=2) setup: upload template + seed field mappings.
 *
 * Source: "Planilha Interativa" Excel from Grupo SBF IR site.
 *   - DRE sheet: "DRE I IncomeStatement", headers in row 2 (e.g., "4Q25")
 *   - BP sheet:  "BP |  BalanceSheet",     headers in row 2 (e.g., "2025" for annual)
 *   - Labels in col B (PT) and col C (EN), data starts row 3.
 *   - Units: R$ mil (thousands).
 *
 * Target: "CENT 4Q25.xlsx" PROJ sheet.
 *   - Labels in col B, quarterly data from col C (4T09) onwards.
 *   - 4T25 = column 67 (BO). Base quarter: 4Q09, col C.
 *   - Units: EN MILES DE R$ (thousands) - no transform needed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { readFileSync } from "fs";
import { companies, fieldMappings } from "./schema";

const COMPANY_ID = 2;
const TEMPLATE_PATH = "data/CENT 4Q25.xlsx";

// ── Income Statement (source: "DRE I IncomeStatement", col header "4Q25") ──
// ex-IFRS16 figures to match PROJ which uses ex-IFRS accounting
const DRE_MAPPINGS = [
  // Source uses ex-IFRS labels from col C (EN), matching PROJ rows
  { sourceLabel: "Gross revenue", targetRow: 3 },
  // Row 4 (Impostos e Ajustes) = Gross revenue - Net revenue, skip for now
  { sourceLabel: "Net revenue", targetRow: 5 },
  { sourceLabel: "Cost of sales", targetRow: 8, validationSign: "negative" },
  { sourceLabel: "Gross profit", targetRow: 9, validationSign: "positive" },
  { sourceLabel: "Selling expenses (w/o depreciation) (ex-IFRS16)", targetRow: 14, validationSign: "negative" },
  { sourceLabel: "Administrative and general expenses (w/o depreciation) (ex-IFRS16)", targetRow: 15, validationSign: "negative" },
  { sourceLabel: "Depreciation and Amortization", targetRow: 16, validationSign: "negative" },
  { sourceLabel: "Other operating income, net (ex-IFRS16)", targetRow: 18 },
  { sourceLabel: "Income before financial result (ex-IFRS16)", targetRow: 19 },
  { sourceLabel: "Financial result (ex-IFRS16)", targetRow: 20 },
  { sourceLabel: "Financial Income (Expenses), net", targetRow: 21 },
  { sourceLabel: "Finance costs (ex-IFRS16)", targetRow: 22, validationSign: "negative" },
  { sourceLabel: "Income before income taxes (ex-IFRS16)", targetRow: 27 },
  { sourceLabel: "Income tax and social contribution (ex-IFRS16)", targetRow: 28 },
  { sourceLabel: "Net income for period (ex-IFRS16)", targetRow: 32 },
];

// ── Balance Sheet (source: "BP |  BalanceSheet", col header "2025" for annual) ──
const BP_MAPPINGS = [
  // Assets
  { sourceLabel: "Cash and cash equivalents", targetRow: 91 },
  { sourceLabel: "Contas a receber", targetRow: 92 },
  { sourceLabel: "Inventory", targetRow: 93 },
  { sourceLabel: "Recoverable taxes", targetRow: 94 },
  // Row 95 = Outros Ativos Op: Dividends receivable + Prepaid expenses + Available-for-sale
  { sourceLabel: "Non-current assets", targetRow: 96, validationSign: "positive" },
  // Long-term receivables
  { sourceLabel: "Long-term receivables", targetRow: 100 },
  { sourceLabel: "Deferred income and social contribution", targetRow: 99 },
  { sourceLabel: "Investments", targetRow: 102 },
  { sourceLabel: "Property and equipment", targetRow: 103 },
  { sourceLabel: "Intangible", targetRow: 104 },
  { sourceLabel: "Total assets", targetRow: 106 },
  // Liabilities
  { sourceLabel: "Suppliers", targetRow: 108 },
  { sourceLabel: "Current liabilities", targetRow: 107, validationSign: "positive" },
  // Row 110 = Financiamentos CP: Loans + Debentures (current)
  { sourceLabel: "Tax liabilities", targetRow: 111 },
  { sourceLabel: "Tax installment payment", targetRow: 112 },
  { sourceLabel: "Dividends payable", targetRow: 113 },
  // Non-current
  // Row 117 = Financiamentos LP: Loans + Debentures (non-current)
  { sourceLabel: "Tax installment", targetRow: 119 },
  { sourceLabel: "Provisions", targetRow: 120 },
  { sourceLabel: "Shareholders' equity", targetRow: 124 },
  { sourceLabel: "Total liabilities and shareholders' equity", targetRow: 126 },
];

async function setup() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  // Verify company exists
  const [company] = await db.select().from(companies).where(eq(companies.id, COMPANY_ID));
  if (!company) throw new Error(`Company ID ${COMPANY_ID} not found`);
  console.log(`Found: ${company.name} (${company.ticker})`);

  // Upload template to Vercel Blob
  console.log("Uploading Excel template to Vercel Blob...");
  const templateBuffer = readFileSync(TEMPLATE_PATH);
  const blob = await put(
    `templates/${COMPANY_ID}/CENT_4Q25.xlsx`,
    templateBuffer,
    { access: "public", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  );
  console.log(`  Uploaded: ${blob.url}`);

  await db
    .update(companies)
    .set({ modelTemplateBlobUrl: blob.url })
    .where(eq(companies.id, COMPANY_ID));
  console.log("  Updated company with template URL");

  // Seed DRE mappings
  console.log("Seeding DRE field mappings...");
  const dreValues = DRE_MAPPINGS.map((m) => ({
    companyId: COMPANY_ID,
    colMode: "quarterly_offset" as const,
    sourceSection: "DRE I IncomeStatement",
    sourceCol: "4Q25",
    sourceLabel: m.sourceLabel,
    targetSheet: "PROJ",
    targetRow: m.targetRow,
    targetColBase: "C",
    targetColStep: 1,
    baseQuarter: "4Q09",
    expectedCurrency: "BRL",
    valueTransform: null,
    validationSign: (m as any).validationSign ?? null,
  }));

  const dreResult = await db.insert(fieldMappings).values(dreValues).returning();
  console.log(`  Seeded ${dreResult.length} DRE mappings`);

  // Seed BP mappings
  console.log("Seeding BP field mappings...");
  const bpValues = BP_MAPPINGS.map((m) => ({
    companyId: COMPANY_ID,
    colMode: "quarterly_offset" as const,
    sourceSection: "BP |  BalanceSheet",
    sourceCol: "2025",
    sourceLabel: m.sourceLabel,
    targetSheet: "PROJ",
    targetRow: m.targetRow,
    targetColBase: "C",
    targetColStep: 1,
    baseQuarter: "4Q09",
    expectedCurrency: "BRL",
    valueTransform: null,
    validationSign: (m as any).validationSign ?? null,
  }));

  const bpResult = await db.insert(fieldMappings).values(bpValues).returning();
  console.log(`  Seeded ${bpResult.length} BP mappings`);

  console.log(`\nDone! CENT has ${dreResult.length + bpResult.length} total mappings.`);
  console.log("Source: Planilha Interativa from ri.gruposbf.com.br");
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
