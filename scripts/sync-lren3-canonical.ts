import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import {
  buildLren3MappingValues,
  LREN3_FAT_FORMULA_ROWS,
  LREN3_NAME,
  LREN3_TICKER,
} from "../src/db/lren3-canonical";

type DbMappingRow = {
  id: number;
  company_id: number;
  col_mode: string;
  source_section: string | null;
  source_label: string;
  source_row: number | null;
  source_col: string | null;
  target_sheet: string;
  target_row: number;
  target_col_base: string;
  target_col_step: number | null;
  base_quarter: string;
  expected_currency: string | null;
  value_transform: string | null;
  validation_sign: string | null;
  is_active: boolean | null;
};

function keyOf(mapping: { target_sheet: string; target_row: number } | { targetSheet: string; targetRow: number }) {
  if ("target_sheet" in mapping) {
    return `${mapping.target_sheet}:${mapping.target_row}`;
  }
  return `${mapping.targetSheet}:${mapping.targetRow}`;
}

function sameValue(a: string | number | null | undefined, b: string | number | null | undefined) {
  return (a ?? null) === (b ?? null);
}

function isExactMatch(existing: DbMappingRow, canonical: ReturnType<typeof buildLren3MappingValues>[number]) {
  return (
    sameValue(existing.col_mode, canonical.colMode) &&
    sameValue(existing.source_section, canonical.sourceSection) &&
    sameValue(existing.source_label, canonical.sourceLabel) &&
    sameValue(existing.source_row, canonical.sourceRow) &&
    sameValue(existing.source_col, canonical.sourceCol) &&
    sameValue(existing.target_sheet, canonical.targetSheet) &&
    sameValue(existing.target_row, canonical.targetRow) &&
    sameValue(existing.target_col_base, canonical.targetColBase) &&
    sameValue(existing.target_col_step, canonical.targetColStep) &&
    sameValue(existing.base_quarter, canonical.baseQuarter) &&
    sameValue(existing.expected_currency, canonical.expectedCurrency) &&
    sameValue(existing.value_transform, canonical.valueTransform) &&
    sameValue(existing.validation_sign, canonical.validationSign) &&
    existing.is_active === true
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = neon(process.env.DATABASE_URL!);

  const companies = await sql`
    SELECT id, name, ticker
    FROM companies
    WHERE ticker = ${LREN3_TICKER}
    ORDER BY id
    LIMIT 1
  `;

  if (companies.length === 0) {
    console.error(`Company ${LREN3_TICKER} (${LREN3_NAME}) not found`);
    process.exit(1);
  }

  const company = companies[0] as { id: number; name: string; ticker: string };
  const canonical = buildLren3MappingValues(company.id);

  const activeMappings = (await sql`
    SELECT
      id,
      company_id,
      col_mode,
      source_section,
      source_label,
      source_row,
      source_col,
      target_sheet,
      target_row,
      target_col_base,
      target_col_step,
      base_quarter,
      expected_currency,
      value_transform,
      validation_sign,
      is_active
    FROM field_mappings
    WHERE company_id = ${company.id} AND is_active = true
    ORDER BY target_sheet, target_row, id
  `) as DbMappingRow[];

  const activeByKey = new Map<string, DbMappingRow[]>();
  for (const mapping of activeMappings) {
    const key = keyOf(mapping);
    const bucket = activeByKey.get(key) ?? [];
    bucket.push(mapping);
    activeByKey.set(key, bucket);
  }

  let unchanged = 0;
  let replaced = 0;
  let inserted = 0;
  let deactivated = 0;

  console.log(
    `${apply ? "Applying" : "Dry run"} canonical sync for ${company.ticker} ` +
      `(company_id=${company.id})`,
  );

  for (const targetRow of LREN3_FAT_FORMULA_ROWS) {
    const legacyKey = `FAT:${targetRow}`;
    const legacyRows = activeByKey.get(legacyKey) ?? [];
    if (legacyRows.length === 0) continue;
    console.log(`- deactivate legacy formula override ${legacyKey}: ${legacyRows.map((row) => row.id).join(", ")}`);
    if (apply) {
      await sql`
        UPDATE field_mappings
        SET is_active = false
        WHERE company_id = ${company.id}
          AND target_sheet = 'FAT'
          AND target_row = ${targetRow}
          AND is_active = true
      `;
    }
    deactivated += legacyRows.length;
    activeByKey.delete(legacyKey);
  }

  for (const mapping of canonical) {
    const key = keyOf(mapping);
    const current = activeByKey.get(key) ?? [];
    if (current.length === 1 && isExactMatch(current[0], mapping)) {
      unchanged++;
      continue;
    }

    if (current.length > 0) {
      console.log(`- replace ${key}: ${current.map((row) => row.id).join(", ")}`);
      replaced += 1;
      deactivated += current.length;
      if (apply) {
        await sql`
          UPDATE field_mappings
          SET is_active = false
          WHERE company_id = ${company.id}
            AND target_sheet = ${mapping.targetSheet}
            AND target_row = ${mapping.targetRow}
            AND is_active = true
        `;
      }
    } else {
      console.log(`- insert ${key}`);
      inserted += 1;
    }

    if (apply) {
      await sql`
        INSERT INTO field_mappings (
          company_id, col_mode, source_section, source_label, source_row, source_col,
          target_sheet, target_row, target_col_base, target_col_step, base_quarter,
          expected_currency, value_transform, validation_sign, is_active
        ) VALUES (
          ${company.id}, ${mapping.colMode}, ${mapping.sourceSection}, ${mapping.sourceLabel},
          ${mapping.sourceRow}, ${mapping.sourceCol}, ${mapping.targetSheet}, ${mapping.targetRow},
          ${mapping.targetColBase}, ${mapping.targetColStep}, ${mapping.baseQuarter},
          ${mapping.expectedCurrency}, ${mapping.valueTransform}, ${mapping.validationSign}, true
        )
      `;
    }
  }

  const canonicalKeys = new Set(canonical.map((mapping) => keyOf(mapping)));
  const extras = activeMappings.filter((mapping) => {
    const key = keyOf(mapping);
    return mapping.is_active === true && !canonicalKeys.has(key) && key !== "FAT:53";
  });

  if (extras.length > 0) {
    console.log("\nExtra active mappings not touched by this sync:");
    for (const extra of extras) {
      console.log(
        `  id=${extra.id} ${extra.target_sheet}!R${extra.target_row} <- ${extra.source_label}`,
      );
    }
    if (apply) {
      const extraIds = extras.map((extra) => extra.id);
      await sql`
        UPDATE field_mappings
        SET is_active = false
        WHERE id = ANY(${extraIds})
      `;
      deactivated += extras.length;
      console.log(`  deactivated extras: ${extraIds.join(", ")}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  unchanged:   ${unchanged}`);
  console.log(`  replaced:    ${replaced}`);
  console.log(`  inserted:    ${inserted}`);
  console.log(`  deactivated: ${deactivated}`);
  console.log(`  mode:        ${apply ? "apply" : "dry-run"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
