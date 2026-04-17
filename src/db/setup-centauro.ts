/**
 * CENTAURO (CENT, company_id=2) setup: upload template + seed the canonical
 * CENT mapping set.
 *
 * Source: "Planilha Interativa" Excel from Grupo SBF IR site.
 *   - DRE sheet: "DRE I IncomeStatement", headers in row 2 (e.g., "4Q25")
 *   - BP sheet:  "BP |  BalanceSheet", headers in row 2 (e.g., "2025" for annual)
 *   - Labels in col B (PT) and col C (EN), data starts row 3.
 *   - Units: R$ mil (thousands).
 *
 * Target: "CENT 4Q25.xlsx" PROJ sheet.
 *   - Labels in col B, quarterly data from col C (4T09) onwards.
 *   - 4T25 = column 67 (BO). Base quarter: 4Q09, col C.
 *   - Units: EN MILES DE R$ (thousands) - no transform needed.
 *
 * The canonical sign state intentionally leaves Investments nullable:
 * a legitimate zero there should not create warning noise on clean runs.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { readFileSync } from "fs";
import { companies, fieldMappings } from "./schema";
import {
  buildCentMappingValues,
  CENT_EXPECTED_MAPPING_COUNT,
  CENT_TEMPLATE_PATH,
} from "./cent-canonical";

const COMPANY_ID = 2;

async function setup() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const [company] = await db.select().from(companies).where(eq(companies.id, COMPANY_ID));
  if (!company) throw new Error(`Company ID ${COMPANY_ID} not found`);
  console.log(`Found: ${company.name} (${company.ticker})`);

  console.log("Uploading Excel template to Vercel Blob...");
  const templateBuffer = readFileSync(CENT_TEMPLATE_PATH);
  const blob = await put(`templates/${COMPANY_ID}/CENT_4Q25.xlsx`, templateBuffer, {
    access: "public",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  console.log(`  Uploaded: ${blob.url}`);

  await db
    .update(companies)
    .set({ modelTemplateBlobUrl: blob.url })
    .where(eq(companies.id, COMPANY_ID));
  console.log("  Updated company with template URL");

  console.log("Seeding canonical CENT field mappings...");
  const result = await db
    .insert(fieldMappings)
    .values(buildCentMappingValues(COMPANY_ID))
    .returning();
  console.log(`  Seeded ${result.length} mappings`);

  if (result.length !== CENT_EXPECTED_MAPPING_COUNT) {
    throw new Error(
      `Expected ${CENT_EXPECTED_MAPPING_COUNT} CENT mappings, seeded ${result.length}`,
    );
  }

  console.log(`\nDone! CENT has ${result.length} total mappings.`);
  console.log("Source: Planilha Interativa from ri.gruposbf.com.br");
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
