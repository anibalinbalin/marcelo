import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { companies } from './schema';

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log('Seeding companies...');
  const result = await db.insert(companies).values([
    { name: 'Grupo Bimbo', ticker: 'BIMBOA', sourceType: 'pdf' },
    { name: 'Grupo SBF / Centauro', ticker: 'CENT', sourceType: 'excel' },
  ]).returning();

  console.log('Seeded:', result.map(c => `${c.name} (id=${c.id})`).join(', '));
}

seed().then(() => {
  console.log('Done!');
  process.exit(0);
}).catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
