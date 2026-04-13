/**
 * Idempotent seed for canonical_concepts. Safe to re-run — inserts by name,
 * skips concepts that already exist. Use after running `pnpm db:push`.
 *
 *   pnpm tsx src/db/seed-canonical-concepts.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import { canonicalConcepts } from './schema';
import { CANONICAL_CONCEPTS } from './canonical-concepts';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const c of CANONICAL_CONCEPTS) {
    const existing = await db
      .select()
      .from(canonicalConcepts)
      .where(eq(canonicalConcepts.name, c.name));

    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    await db.insert(canonicalConcepts).values({
      name: c.name,
      category: c.category,
      typicalSign: c.typicalSign,
      description: c.description ?? null,
    });
    inserted += 1;
  }

  const total = await db.select().from(canonicalConcepts);
  console.log(`\ninserted: ${inserted}`);
  console.log(`skipped:  ${skipped}`);
  console.log(`total in DB: ${total.length}`);
  console.log(`seed source length: ${CANONICAL_CONCEPTS.length}`);

  if (total.length < CANONICAL_CONCEPTS.length) {
    console.error('total in DB is less than seed source — something went wrong');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('seed error:', err);
  process.exit(1);
});
