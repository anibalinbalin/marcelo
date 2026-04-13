/**
 * Walk every field_mappings row, match its sourceLabel against the canonical
 * concept list, and:
 *   - set field_mappings.concept_id
 *   - insert a concept_aliases row for the (conceptId, normalized label,
 *     sourceCompanyId) triple (if not already present)
 *
 *   pnpm tsx src/db/backfill-concept-mappings.ts           # dry-run (default)
 *   pnpm tsx src/db/backfill-concept-mappings.ts --apply   # actually write
 *
 * Safe to re-run — skip mappings that already have concept_id.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, eq, isNull } from 'drizzle-orm';
import {
  fieldMappings,
  canonicalConcepts,
  conceptAliases,
} from './schema';
import { CANONICAL_CONCEPTS } from './canonical-concepts';
import { matchLabelToConcept, normalizeLabel } from '../lib/extraction/concept-matcher';

const APPLY = process.argv.includes('--apply');

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function main() {
  const concepts = await db.select().from(canonicalConcepts);
  if (concepts.length === 0) {
    console.error('canonical_concepts is empty — run seed-canonical-concepts.ts first');
    process.exit(1);
  }
  const conceptByName = new Map(concepts.map((c) => [c.name, c]));

  const rows = await db
    .select({
      id: fieldMappings.id,
      companyId: fieldMappings.companyId,
      sourceLabel: fieldMappings.sourceLabel,
      sourceSection: fieldMappings.sourceSection,
      conceptId: fieldMappings.conceptId,
    })
    .from(fieldMappings);

  console.log(`scanning ${rows.length} field_mappings rows (apply=${APPLY})`);

  let alreadyMapped = 0;
  let matched = 0;
  let unmatched = 0;
  const unmatchedSamples: string[] = [];

  for (const row of rows) {
    if (row.conceptId != null) {
      alreadyMapped += 1;
      continue;
    }

    const hit = matchLabelToConcept(row.sourceLabel, CANONICAL_CONCEPTS);
    if (!hit) {
      unmatched += 1;
      if (unmatchedSamples.length < 20) {
        unmatchedSamples.push(`  - mapping ${row.id} / company ${row.companyId} / "${row.sourceLabel}" (${row.sourceSection ?? '-'})`);
      }
      continue;
    }

    const dbConcept = conceptByName.get(hit.name);
    if (!dbConcept) {
      console.error(`concept "${hit.name}" returned by matcher but missing from DB — seed drift?`);
      process.exit(1);
    }

    matched += 1;

    if (!APPLY) continue;

    await db
      .update(fieldMappings)
      .set({ conceptId: dbConcept.id, lastVerifiedAt: new Date() })
      .where(eq(fieldMappings.id, row.id));

    const normalized = normalizeLabel(row.sourceLabel);
    const existingAlias = await db
      .select({ id: conceptAliases.id })
      .from(conceptAliases)
      .where(and(eq(conceptAliases.conceptId, dbConcept.id), eq(conceptAliases.aliasText, normalized)));

    if (existingAlias.length === 0) {
      await db.insert(conceptAliases).values({
        conceptId: dbConcept.id,
        aliasText: normalized,
        language: null,
        sourceCompanyId: row.companyId ?? null,
      });
    }
  }

  console.log(`\nalready mapped: ${alreadyMapped}`);
  console.log(`matched:        ${matched}`);
  console.log(`unmatched:      ${unmatched}`);
  if (unmatched > 0) {
    console.log('\nunmatched samples (first 20):');
    for (const s of unmatchedSamples) console.log(s);
    console.log('\nAdd aliases for these to concept-matcher.ts and re-run.');
  }

  if (APPLY) {
    const withConcept = await db
      .select()
      .from(fieldMappings)
      .where(isNull(fieldMappings.conceptId));
    const totalAliases = await db.select().from(conceptAliases);
    console.log(`\nAFTER APPLY:`);
    console.log(`  field_mappings still without concept_id: ${withConcept.length}`);
    console.log(`  total concept_aliases rows: ${totalAliases.length}`);
  }
}

main().catch((err) => {
  console.error('backfill error:', err);
  process.exit(1);
});
