# Extraction Memory — Foundation (Phase 1 + 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data-model foundation (canonical concepts, aliases, mapping history, confidence columns) and backfill it from the 7 existing companies, with zero change to current extraction behavior. Unblocks the rest of the Extraction Memory System (alias lookup, confidence tracking, review UI, onboarding suggester).

**Architecture:** Add three new Postgres tables and a handful of nullable columns via Drizzle, push to Neon with `drizzle-kit push`, then run two one-shot TypeScript scripts against the live DB — one to seed ~50 canonical financial concepts, one to walk every existing `field_mappings` row and wire it to a concept + create aliases. All additions are nullable / default-valued, so current code paths keep working exactly as they do today.

**Tech Stack:** Drizzle ORM 0.45 + drizzle-kit 0.31 (`pgTable`, `jsonb`, `real`), Neon serverless driver (`@neondatabase/serverless`), Postgres, Vitest, `tsx`, dotenv-cli.

**Reference spec:** `docs/superpowers/specs/2026-04-13-extraction-memory-design.md`

---

## File Structure

**Schema (modified):**
- `src/db/schema.ts` — add `canonicalConcepts`, `conceptAliases`, `mappingHistory` tables, add columns to `fieldMappings` and `extractedValues`, add relations, add `jsonb` import.

**Seed data & script (new):**
- `src/db/canonical-concepts.ts` — typed constant array of ~50 seed concepts (no DB access, importable by tests and scripts).
- `src/db/seed-canonical-concepts.ts` — one-shot script: upserts concepts by name. Idempotent, safe to re-run.

**Backfill logic (new):**
- `src/lib/extraction/concept-matcher.ts` — pure function `matchLabelToConcept(label, concepts)` that normalizes a source label and picks the best canonical concept (or returns `null`). No DB access.
- `src/lib/extraction/__tests__/concept-matcher.test.ts` — Vitest unit tests for the matcher.
- `src/db/backfill-concept-mappings.ts` — one-shot script: walks all `field_mappings` rows, calls the matcher, writes `conceptId` and creates `concept_aliases` rows. Supports `--dry-run` and `--apply` modes.

**Docs (modified):**
- none — the spec is the source of truth.

No existing extraction / pipeline / UI code is touched in this plan. Phase 3+ (alias lookup, UI) lives in later plans.

---

## Task 1: Add new tables and columns to Drizzle schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add `jsonb` to the drizzle-orm import**

Open `src/db/schema.ts` and change the imports at the top of the file:

```ts
import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Append three new tables at the end of the table section (before relations)**

Add after the existing `extractedValues` table definition, before the `companiesRelations` block:

```ts
// ── Canonical Concepts ──────────────────────────────────────────────────────
export const canonicalConcepts = pgTable('canonical_concepts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  category: text('category').notNull(), // "income_statement" | "balance_sheet" | "cash_flow"
  typicalSign: text('typical_sign'),    // "positive" | "negative" | "either"
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Concept Aliases ─────────────────────────────────────────────────────────
export const conceptAliases = pgTable('concept_aliases', {
  id: serial('id').primaryKey(),
  conceptId: integer('concept_id').references(() => canonicalConcepts.id).notNull(),
  aliasText: text('alias_text').notNull(),
  language: text('language'),
  sourceCompanyId: integer('source_company_id').references(() => companies.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Mapping History ─────────────────────────────────────────────────────────
export const mappingHistory = pgTable('mapping_history', {
  id: serial('id').primaryKey(),
  mappingId: integer('mapping_id').references(() => fieldMappings.id).notNull(),
  previousValues: jsonb('previous_values').notNull(),
  changeReason: text('change_reason'),
  changedBy: text('changed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

- [ ] **Step 3: Add new columns to `fieldMappings`**

Locate the `fieldMappings` definition (currently around line 24) and add these fields after the existing `isActive` field, before `updatedAt`:

```ts
  conceptId: integer('concept_id').references(() => canonicalConcepts.id),
  confidenceScore: real('confidence_score').default(0.5),
  lastVerifiedAt: timestamp('last_verified_at'),
  correctionCount: integer('correction_count').default(0),
  supersededBy: integer('superseded_by'),
```

Note: `supersededBy` is intentionally NOT wired as a self-reference via `references()` — Drizzle does not support forward self-references cleanly inside the same `pgTable` call. It is still an `integer` column; we enforce the FK in a later phase when we actually start writing to it.

- [ ] **Step 4: Add new column to `extractedValues`**

In the `extractedValues` definition, add after the existing `analystOverride` field, before `createdAt`:

```ts
  matchedAliasId: integer('matched_alias_id').references(() => conceptAliases.id),
```

- [ ] **Step 5: Add relations for the new tables**

Append to the relations section at the bottom of the file:

```ts
export const canonicalConceptsRelations = relations(canonicalConcepts, ({ many }) => ({
  aliases: many(conceptAliases),
  fieldMappings: many(fieldMappings),
}));

export const conceptAliasesRelations = relations(conceptAliases, ({ one }) => ({
  concept: one(canonicalConcepts, {
    fields: [conceptAliases.conceptId],
    references: [canonicalConcepts.id],
  }),
  sourceCompany: one(companies, {
    fields: [conceptAliases.sourceCompanyId],
    references: [companies.id],
  }),
}));

export const mappingHistoryRelations = relations(mappingHistory, ({ one }) => ({
  mapping: one(fieldMappings, {
    fields: [mappingHistory.mappingId],
    references: [fieldMappings.id],
  }),
}));
```

Also extend `fieldMappingsRelations` to include the concept relation. Replace the existing block with:

```ts
export const fieldMappingsRelations = relations(fieldMappings, ({ one, many }) => ({
  company: one(companies, {
    fields: [fieldMappings.companyId],
    references: [companies.id],
  }),
  concept: one(canonicalConcepts, {
    fields: [fieldMappings.conceptId],
    references: [canonicalConcepts.id],
  }),
  extractedValues: many(extractedValues),
  history: many(mappingHistory),
}));
```

- [ ] **Step 6: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors. If there is an error complaining that `fieldMappings` is referenced before declaration inside `canonicalConceptsRelations`, reorder: move `canonicalConceptsRelations` below `fieldMappingsRelations`.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): add canonical concepts, aliases, mapping history tables"
```

---

## Task 2: Push schema to Neon and verify

**Files:**
- Modify: `package.json` (add a `db:push` script if not already present)

- [ ] **Step 1: Add a `db:push` npm script**

Open `package.json` and add to `"scripts"` (preserving the existing `dev` line):

```json
    "db:push": "dotenv -e .env.local -- drizzle-kit push"
```

- [ ] **Step 2: Commit the script change**

```bash
git add package.json
git commit -m "chore: add db:push script for drizzle-kit"
```

- [ ] **Step 3: Run the push**

Run: `pnpm db:push`

drizzle-kit will print a diff with three new tables (`canonical_concepts`, `concept_aliases`, `mapping_history`) and five new columns (`field_mappings.concept_id`, `field_mappings.confidence_score`, `field_mappings.last_verified_at`, `field_mappings.correction_count`, `field_mappings.superseded_by`, `extracted_values.matched_alias_id`).

Confirm with `y` / `Yes`.

Expected: `[✓] Changes applied`.

- [ ] **Step 4: Verify tables exist**

Run via Proxmox/local psql or a throwaway tsx script. Use tsx inline:

```bash
pnpm tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const rows = await sql\`select table_name from information_schema.tables where table_schema='public' and table_name in ('canonical_concepts','concept_aliases','mapping_history') order by table_name\`;
  console.log(rows);
})();
"
```

Expected: three rows printed, one for each new table.

- [ ] **Step 5: Verify new columns on `field_mappings`**

```bash
pnpm tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const rows = await sql\`select column_name from information_schema.columns where table_name='field_mappings' and column_name in ('concept_id','confidence_score','last_verified_at','correction_count','superseded_by') order by column_name\`;
  console.log(rows);
})();
"
```

Expected: five rows printed.

---

## Task 3: Add canonical concepts seed data

**Files:**
- Create: `src/db/canonical-concepts.ts`

- [ ] **Step 1: Create the seed data module**

Create `src/db/canonical-concepts.ts` with the full seed list:

```ts
/**
 * Canonical financial concepts. The semantic layer of the Extraction Memory
 * System — every concept here is the "one true" identifier for a line item
 * across every company, regardless of language or label wording.
 *
 * Importable without a DB connection so it can be unit-tested and reused by
 * the matcher and the seed script.
 */

export type ConceptCategory = 'income_statement' | 'balance_sheet' | 'cash_flow';
export type TypicalSign = 'positive' | 'negative' | 'either';

export type CanonicalConceptSeed = {
  name: string;
  category: ConceptCategory;
  typicalSign: TypicalSign;
  description?: string;
};

export const CANONICAL_CONCEPTS: CanonicalConceptSeed[] = [
  // ─── Income Statement ─────────────────────────────────────────────────────
  { name: 'Net Revenue', category: 'income_statement', typicalSign: 'positive', description: 'Top-line revenue, net of discounts and returns' },
  { name: 'Gross Revenue', category: 'income_statement', typicalSign: 'positive' },
  { name: 'Cost of Sales', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Gross Profit', category: 'income_statement', typicalSign: 'positive' },
  { name: 'Selling Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'General and Administrative Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Other Operating Income', category: 'income_statement', typicalSign: 'either' },
  { name: 'Other Operating Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Operating Income', category: 'income_statement', typicalSign: 'either', description: 'EBIT' },
  { name: 'EBITDA', category: 'income_statement', typicalSign: 'either' },
  { name: 'Depreciation and Amortization', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Financial Income', category: 'income_statement', typicalSign: 'positive' },
  { name: 'Financial Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Net Financial Result', category: 'income_statement', typicalSign: 'either' },
  { name: 'Equity Pick-ups', category: 'income_statement', typicalSign: 'either' },
  { name: 'Income Before Taxes', category: 'income_statement', typicalSign: 'either' },
  { name: 'Income Tax and Social Contribution', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Net Income', category: 'income_statement', typicalSign: 'either' },
  { name: 'Minority Interest', category: 'income_statement', typicalSign: 'either' },
  { name: 'Losses on Receivables', category: 'income_statement', typicalSign: 'negative' },

  // ─── Balance Sheet — Assets ───────────────────────────────────────────────
  { name: 'Cash and Equivalents', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Short-term Investments', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Accounts Receivable', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Inventories', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Recoverable Taxes Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Other Current Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Current Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Recoverable Taxes Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Deferred Taxes', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Investments', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Property Plant and Equipment', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Right of Use Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Intangible Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Noncurrent Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Assets', category: 'balance_sheet', typicalSign: 'positive' },

  // ─── Balance Sheet — Liabilities & Equity ─────────────────────────────────
  { name: 'Suppliers', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Loans and Financing Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Lease Liabilities Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Other Accounts Payable Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Current Liabilities', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Loans and Financing Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Lease Liabilities Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Deferred Income Tax Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Other Accounts Payable Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Noncurrent Liabilities', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Stockholders Equity', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Liabilities and Equity', category: 'balance_sheet', typicalSign: 'positive' },

  // ─── Cash Flow ────────────────────────────────────────────────────────────
  { name: 'Cash From Operations', category: 'cash_flow', typicalSign: 'either' },
  { name: 'Capital Expenditures', category: 'cash_flow', typicalSign: 'negative' },
  { name: 'Cash From Investing', category: 'cash_flow', typicalSign: 'either' },
  { name: 'Cash From Financing', category: 'cash_flow', typicalSign: 'either' },
  { name: 'Net Change in Cash', category: 'cash_flow', typicalSign: 'either' },
];
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/canonical-concepts.ts
git commit -m "feat(db): seed list of ~50 canonical financial concepts"
```

---

## Task 4: Write the concept-matcher with tests (TDD)

**Files:**
- Create: `src/lib/extraction/concept-matcher.ts`
- Test: `src/lib/extraction/__tests__/concept-matcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/extraction/__tests__/concept-matcher.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchLabelToConcept, normalizeLabel } from '../concept-matcher';
import { CANONICAL_CONCEPTS } from '../../../db/canonical-concepts';

describe('normalizeLabel', () => {
  it('strips accents, lowercases, and collapses whitespace', () => {
    expect(normalizeLabel('  Receita   Líquida ')).toBe('receita liquida');
  });

  it('removes parenthetical notes', () => {
    expect(normalizeLabel('Net Income (attributable to shareholders)')).toBe('net income');
  });

  it('collapses punctuation', () => {
    expect(normalizeLabel('Cost of Sales, Net')).toBe('cost of sales net');
  });
});

describe('matchLabelToConcept', () => {
  it('returns exact match ignoring case and accents', () => {
    const hit = matchLabelToConcept('NET REVENUE', CANONICAL_CONCEPTS);
    expect(hit?.name).toBe('Net Revenue');
  });

  it('matches a Portuguese alias via the alias dictionary', () => {
    const hit = matchLabelToConcept('Receita Líquida', CANONICAL_CONCEPTS);
    expect(hit?.name).toBe('Net Revenue');
  });

  it('returns null when no confident match exists', () => {
    const hit = matchLabelToConcept('Totally Unknown Line', CANONICAL_CONCEPTS);
    expect(hit).toBeNull();
  });

  it('disambiguates current vs noncurrent recoverable taxes by keyword', () => {
    const current = matchLabelToConcept('Recoverable Taxes (current)', CANONICAL_CONCEPTS);
    const noncurrent = matchLabelToConcept('Recoverable Taxes (noncurrent)', CANONICAL_CONCEPTS);
    expect(current?.name).toBe('Recoverable Taxes Current');
    expect(noncurrent?.name).toBe('Recoverable Taxes Noncurrent');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/extraction/__tests__/concept-matcher.test.ts`
Expected: FAIL — module `../concept-matcher` does not exist.

- [ ] **Step 3: Implement the minimal matcher**

Create `src/lib/extraction/concept-matcher.ts`:

```ts
import type { CanonicalConceptSeed } from '../../db/canonical-concepts';

const PT_TO_EN: Record<string, string> = {
  'receita liquida': 'net revenue',
  'receita bruta': 'gross revenue',
  'custo dos produtos vendidos': 'cost of sales',
  'custo das mercadorias vendidas': 'cost of sales',
  'lucro bruto': 'gross profit',
  'despesas com vendas': 'selling expenses',
  'despesas gerais e administrativas': 'general and administrative expenses',
  'ebitda': 'ebitda',
  'depreciacao e amortizacao': 'depreciation and amortization',
  'resultado financeiro liquido': 'net financial result',
  'resultado de participacoes': 'equity pick-ups',
  'lucro antes do imposto': 'income before taxes',
  'imposto de renda e contribuicao social': 'income tax and social contribution',
  'lucro liquido': 'net income',
  'caixa e equivalentes': 'cash and equivalents',
  'contas a receber': 'accounts receivable',
  'estoques': 'inventories',
  'imobilizado': 'property plant and equipment',
  'direito de uso': 'right of use assets',
  'intangivel': 'intangible assets',
  'ativo total': 'total assets',
  'fornecedores': 'suppliers',
  'patrimonio liquido': 'stockholders equity',
};

const ES_TO_EN: Record<string, string> = {
  'ingresos netos': 'net revenue',
  'costo de ventas': 'cost of sales',
  'utilidad bruta': 'gross profit',
  'utilidad neta': 'net income',
  'efectivo y equivalentes': 'cash and equivalents',
  'activo total': 'total assets',
  'capital contable': 'stockholders equity',
};

export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')     // strip diacritics
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')          // drop parentheticals
    .replace(/[^a-z0-9\s]/g, ' ')        // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
}

function translate(label: string): string {
  if (PT_TO_EN[label]) return PT_TO_EN[label];
  if (ES_TO_EN[label]) return ES_TO_EN[label];
  return label;
}

export function matchLabelToConcept(
  rawLabel: string,
  concepts: readonly CanonicalConceptSeed[],
): CanonicalConceptSeed | null {
  const normalized = translate(normalizeLabel(rawLabel));

  // Exact normalized match on concept name
  for (const c of concepts) {
    if (normalizeLabel(c.name) === normalized) return c;
  }

  // Disambiguation: "recoverable taxes" + current/noncurrent keyword
  if (normalized.includes('recoverable taxes')) {
    const isNoncurrent = /\b(noncurrent|non current|long term|longo prazo)\b/.test(normalized);
    const targetName = isNoncurrent ? 'Recoverable Taxes Noncurrent' : 'Recoverable Taxes Current';
    return concepts.find((c) => c.name === targetName) ?? null;
  }

  // Prefix / suffix contains match — all-words-present
  const words = normalized.split(' ').filter(Boolean);
  for (const c of concepts) {
    const cn = normalizeLabel(c.name);
    if (words.length > 1 && words.every((w) => cn.includes(w))) return c;
  }

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/extraction/__tests__/concept-matcher.test.ts`
Expected: PASS — all 7 cases green. If a case fails, read the actual normalized output printed by vitest and extend `PT_TO_EN` / `ES_TO_EN` rather than weakening an assertion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extraction/concept-matcher.ts src/lib/extraction/__tests__/concept-matcher.test.ts
git commit -m "feat(extraction): concept matcher with PT/ES alias dictionary"
```

---

## Task 5: Seed canonical concepts into the DB

**Files:**
- Create: `src/db/seed-canonical-concepts.ts`

- [ ] **Step 1: Write the seed script**

Create `src/db/seed-canonical-concepts.ts`:

```ts
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
```

- [ ] **Step 2: Run the seed script**

Run: `pnpm tsx src/db/seed-canonical-concepts.ts`
Expected output ends with:

```
inserted: 52   (or whatever CANONICAL_CONCEPTS.length is)
skipped:  0
total in DB: 52
seed source length: 52
```

- [ ] **Step 3: Run it again to confirm idempotency**

Run: `pnpm tsx src/db/seed-canonical-concepts.ts`
Expected: `inserted: 0`, `skipped: 52`.

- [ ] **Step 4: Commit**

```bash
git add src/db/seed-canonical-concepts.ts
git commit -m "feat(db): idempotent seed script for canonical concepts"
```

---

## Task 6: Write the backfill script (dry-run first)

**Files:**
- Create: `src/db/backfill-concept-mappings.ts`

- [ ] **Step 1: Write the backfill script with dry-run + apply modes**

Create `src/db/backfill-concept-mappings.ts`:

```ts
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
  companies,
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/backfill-concept-mappings.ts
git commit -m "feat(db): backfill script for concept mappings (dry-run + apply)"
```

---

## Task 7: Run backfill dry-run and tighten the matcher

**Files:**
- Modify (potentially): `src/lib/extraction/concept-matcher.ts`
- Modify (potentially): `src/db/canonical-concepts.ts`

- [ ] **Step 1: Run the dry-run**

Run: `pnpm tsx src/db/backfill-concept-mappings.ts`
Expected: a summary with `matched` and `unmatched` counts, plus up to 20 unmatched samples.

- [ ] **Step 2: Review the unmatched samples**

Read the printed samples. For each, decide one of:

1. **Known concept, new alias**: add an entry to `PT_TO_EN` or `ES_TO_EN` in `src/lib/extraction/concept-matcher.ts`. Example: if you see `"Ingresos por servicios"` → add `'ingresos por servicios': 'net revenue'`.
2. **New concept worth adding**: add an entry to `CANONICAL_CONCEPTS` in `src/db/canonical-concepts.ts` and re-run the seed script (`pnpm tsx src/db/seed-canonical-concepts.ts`).
3. **Non-financial / leave unmatched**: fine — those mappings will stay with `conceptId = null` and get handled in a later phase.

- [ ] **Step 3: Re-run dry-run until matched >= 85% of all rows**

Run: `pnpm tsx src/db/backfill-concept-mappings.ts`
Target: `matched / (matched + unmatched) >= 0.85`. Most of the remaining unmatched should be genuinely obscure / company-specific labels, not translation gaps.

- [ ] **Step 4: Commit matcher / seed changes (if any)**

```bash
git add -u src/lib/extraction/concept-matcher.ts src/db/canonical-concepts.ts
git commit -m "feat(extraction): expand matcher dictionary for backfill coverage"
```

(Skip this step if nothing changed.)

---

## Task 8: Run backfill live and verify

**Files:**
- none — DB-only step.

- [ ] **Step 1: Snapshot current state for rollback**

```bash
pnpm tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const fmCount = await sql\`select count(*) from field_mappings\`;
  const fmWithConcept = await sql\`select count(*) from field_mappings where concept_id is not null\`;
  const aliasCount = await sql\`select count(*) from concept_aliases\`;
  console.log('field_mappings total:', fmCount[0].count);
  console.log('field_mappings with concept_id:', fmWithConcept[0].count);
  console.log('concept_aliases:', aliasCount[0].count);
})();
"
```

Expected (before backfill): `field_mappings with concept_id: 0`, `concept_aliases: 0`.

- [ ] **Step 2: Run the backfill in apply mode**

Run: `pnpm tsx src/db/backfill-concept-mappings.ts --apply`
Expected: same matched/unmatched numbers as the last dry-run, plus an AFTER APPLY block showing `field_mappings still without concept_id` equal to the unmatched count and `total concept_aliases rows` > 0.

- [ ] **Step 3: Verify no existing extraction regressed**

Run the E2E smoke test harness against an existing run from the current 7 companies — this is the acceptance gate that Phase 1+2 caused zero behavior change. Use the same script the review flow uses:

```bash
pnpm tsx scripts/e2e-test-runs.ts <recentLren3RunId>
```

Replace `<recentLren3RunId>` with the most recent LREN3 run id in the DB (pick with `pnpm tsx -e "..."` if needed). Expected: `PASS` with `cellsWritten > 0` and `errors: 0`. If this fails, something in the schema change broke writeback — investigate before continuing.

- [ ] **Step 4: Update the WIP memory file**

Update `~/.claude/projects/-Users-anibalin-Sites-2026-marcelo/memory/project_extraction_memory_design_wip.md` to reflect that Phase 1+2 is done: change the status block to say "Phases 1+2 shipped YYYY-MM-DD, Phases 3–6 pending." This keeps the next session honest.

- [ ] **Step 5: Commit memory update**

Memory lives outside the repo, so there is nothing to commit in the working tree. Skip.

- [ ] **Step 6: Final sanity print**

```bash
pnpm tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const rows = await sql\`
    select c.name, count(a.id) as alias_count
    from canonical_concepts c
    left join concept_aliases a on a.concept_id = c.id
    group by c.name
    order by alias_count desc
    limit 15\`;
  console.log(rows);
})();
"
```

Expected: a table of the top 15 concepts by alias count. The top entries should be obvious high-frequency line items like `Net Revenue`, `Total Assets`, `Net Income`, etc., each with several aliases drawn from different companies. This is the first visible compound-learning payoff.

---

## Done Criteria

- All 8 tasks' commits are on `main` (or the feature branch).
- `canonical_concepts` has ≥ `CANONICAL_CONCEPTS.length` rows.
- ≥ 85% of `field_mappings` rows have a non-null `concept_id`.
- `concept_aliases` has > 0 rows and the top-15 query above shows recognizable concepts.
- `pnpm tsx scripts/e2e-test-runs.ts <existingRunId>` still passes with zero integrity errors.
- `pnpm vitest run src/lib/extraction/__tests__/concept-matcher.test.ts` passes.

Once all of the above is green, this plan is complete and we are ready to start Plan 2 (alias lookup in the extraction pipeline — Phase 3 of the spec).
