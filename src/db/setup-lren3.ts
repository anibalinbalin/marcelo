/**
 * One-shot LREN3 (Lojas Renner) setup: create company, upload template, seed
 * the canonical PROJ + FAT mappings for the current 4Q25 model.
 *
 * Source: Renner Planilhas e Fundamentos Excel (published by the company with
 * quarterly data). This is Excel-to-Excel extraction — no PDF needed.
 *
 * The canonical mapping list intentionally excludes FAT row 53. Camila's
 * convention is: raw line items get hardcoded into FAT, derived rows stay as
 * formulas in the template.
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
  buildLren3MappingValues,
  LREN3_NAME,
  LREN3_TEMPLATE_PATH,
  LREN3_TICKER,
} from "./lren3-canonical";

async function setup() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  // 1. Create company
  console.log("Creating LREN3 company record...");
  const [company] = await db
    .insert(companies)
    .values({
      name: LREN3_NAME,
      ticker: LREN3_TICKER,
      sourceType: "excel",
    })
    .returning();
  console.log(`  Created company ID ${company.id}`);

  // 2. Upload template
  console.log("Uploading Excel template to Vercel Blob...");
  const templateBuffer = readFileSync(LREN3_TEMPLATE_PATH);
  const blob = await put(`templates/${company.id}/LREN3_OK.xlsx`, templateBuffer, {
    access: "public",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  console.log(`  Uploaded: ${blob.url}`);

  // 3. Update company with template URL
  await db
    .update(companies)
    .set({ modelTemplateBlobUrl: blob.url })
    .where(eq(companies.id, company.id));
  console.log("  Updated company with template URL");

  // 4. Seed canonical field mappings
  console.log("Seeding canonical LREN3 field mappings...");
  const result = await db
    .insert(fieldMappings)
    .values(buildLren3MappingValues(company.id))
    .returning();
  console.log(`  Seeded ${result.length} mappings`);

  const projCount = result.filter((mapping) => mapping.targetSheet === "PROJ").length;
  const fatCount = result.filter((mapping) => mapping.targetSheet === "FAT").length;

  console.log(
    `\nDone! ${LREN3_TICKER} is company ID ${company.id}. ` +
      `Mappings: PROJ=${projCount}, FAT=${fatCount}.`,
  );
  console.log("Source file: Renner Planilhas e Fundamentos (6).xlsx");
}

setup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
