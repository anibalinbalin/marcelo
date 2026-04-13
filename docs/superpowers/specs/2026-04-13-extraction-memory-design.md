# Extraction Memory System

**Date**: 2026-04-13
**Status**: Approved (design)
**Problem**: Analysts spend most of their time reviewing — 15–30 manual corrections per company per quarter — which caps capacity at ~20 clients each. To stay economically viable and onboard Fundamenta, we need ~100 clients per analyst (5x). The bottleneck is not extraction speed but the cost of every correction disappearing after it is made: the same label change, column offset, or accounting-variant mistake will reappear next quarter, on every similar company, because `field_mappings` has no memory of *why* a mapping was right.

---

## Root Cause

The current `field_mappings` table is a flat per-company label map. Every piece of cross-company knowledge — that "Net Revenue" = "Receita Líquida" = "Ingresos netos", that LREN3 row 14 is current Recoverable Taxes and row 21 is noncurrent, that CENT reports ex-IFRS16 figures to match PROJ accounting — lives only in the analyst's head, in comments inside `src/db/setup-centauro.ts`, or is implicit in `sourceRow` disambiguators. Corrections update values on a single `extracted_values` row (`analystOverride`) but never feed back into the mapping itself, never propagate to other companies, and never survive as reusable knowledge.

The result is three recurring error classes consuming analyst time:

- **A) Wrong column/row** — label matched but the wrong quarter or the wrong section was picked. Most common.
- **D) Label changed in source** — company renamed a line item between quarters. Common.
- **C) Unit/format mismatch** — thousands vs millions, sign flip. Less common.

Each correction costs 1–2 minutes of analyst time. At 15–30 corrections × 20 companies × 4 quarters = 1,200–2,400 corrections per analyst per year, none of which make the system smarter.

---

## Goal

Formalize the knowledge analysts already apply manually when onboarding new companies ("this looks like BIMBO, copy those mappings and adapt"). Every correction and every confirmed extraction becomes a durable, cross-company-visible data point, so that:

1. A new alias for "Net Revenue" learned on LREN3 is immediately usable on BIMBO.
2. Confidence in each mapping rises with every approval and falls with every correction, so analysts can skip values the system has already gotten right 50 times in a row.
3. Onboarding a new company starts with suggested mappings from the N most similar existing companies, not a blank slate.
4. The analyst review UI hides auto-approved high-confidence values and focuses attention on what actually needs a human.

Target: 15–30 corrections/quarter → 3–5. Onboarding: 4h → 30min. Capacity: 20 → 100 clients/analyst.

---

## Design

### 1. Data Model Changes

**New tables:**

```ts
// Canonical financial concepts — shared across all companies, the semantic layer
export const canonicalConcepts = pgTable('canonical_concepts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),           // "Net Revenue", "Total Assets", ...
  category: text('category').notNull(),   // "income_statement" | "balance_sheet" | "cash_flow"
  typicalSign: text('typical_sign'),      // "positive" | "negative" | "either"
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Aliases — every label the system has ever seen for a concept, in any language
export const conceptAliases = pgTable('concept_aliases', {
  id: serial('id').primaryKey(),
  conceptId: integer('concept_id').references(() => canonicalConcepts.id).notNull(),
  aliasText: text('alias_text').notNull(),       // "Receita Líquida", "Ingresos netos"
  language: text('language'),                    // "pt" | "es" | "en"
  sourceCompanyId: integer('source_company_id').references(() => companies.id),  // where we learned it
  createdAt: timestamp('created_at').defaultNow(),
});

// Every mapping change over time — so we can audit, revert, and learn
export const mappingHistory = pgTable('mapping_history', {
  id: serial('id').primaryKey(),
  mappingId: integer('mapping_id').references(() => fieldMappings.id).notNull(),
  previousValues: jsonb('previous_values').notNull(),  // snapshot of the mapping row before the change
  changeReason: text('change_reason'),                 // "analyst_correction" | "label_drift" | ...
  changedBy: text('changed_by'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**Changes to `field_mappings`:**

```ts
// additions
conceptId: integer('concept_id').references(() => canonicalConcepts.id),
confidenceScore: real('confidence_score').default(0.5),
lastVerifiedAt: timestamp('last_verified_at'),
correctionCount: integer('correction_count').default(0),
supersededBy: integer('superseded_by').references(() => fieldMappings.id),
```

`supersededBy` lets us keep old mappings as history instead of in-place updating them, so we can see what the mapping *was* last quarter.

**Changes to `extracted_values`:**

```ts
matchedAliasId: integer('matched_alias_id').references(() => conceptAliases.id),
```

Lets us trace which alias produced which value — essential for blaming the right alias when an extraction is wrong and for promoting an alias to "canonical" once it has enough successful matches.

### 2. Canonical Concepts & Alias Matching

**Seed**: ~50 core financial concepts hand-curated at kickoff — Net Revenue, Gross Profit, Operating Income, EBITDA, Net Income, Total Assets, Total Liabilities, Stockholders' Equity, Cash & Equivalents, CapEx, Depreciation, etc. Category + typical sign. Enough to cover the income statement, balance sheet, and cash-flow headlines on every company we have today.

**Backfill**: Walk every `field_mappings` row across the 7 existing companies. For each, match its `sourceLabel` to the closest canonical concept (exact string first, then manual review for the rest). Write a `concept_aliases` row for every distinct label seen, tagged with its source company and language. Write `concept_id` onto the mapping. Expected: ~150–250 aliases across the 7 companies after backfill.

**Extraction-time flow**:

```
sourceLabel (from PDF/Excel)
    → exact match in concept_aliases
    → found → concept → mapping → extracted value
    → not found → fall back to current label-matching
                → on success, flag as "new alias candidate" for analyst review
                → on analyst confirmation, create concept_aliases row (compound learning)
```

Every correction teaches the system one new alias. After one quarter across 20 companies, the alias table should absorb most natural label drift.

### 3. Cross-Company Similarity (Onboarding Accelerator)

When an analyst onboards a new company, rank existing companies by similarity and pre-suggest mappings grouped by concept.

**Similarity factors** (tuned via analyst feedback, starting weights):

| Factor | Weight | Why |
|---|---|---|
| Source type (PDF/Excel/BIVA) | 30% | Determines the extraction path and column layout entirely |
| Country / GAAP | 25% | IFRS vs MX-GAAP vs US-GAAP drives statement structure and terminology |
| Statement structure (detected headers) | 25% | Two IFRS filers can still have very different line-item granularity |
| Industry | 20% | Retail vs telecom vs bank have wildly different line items |

**Flow**:

1. Analyst uploads sample source file for new company
2. System extracts headers / section names
3. Rank top 3 similar companies
4. For each detected header, suggest the concept(s) those similar companies mapped to that label, sorted by confidence
5. Analyst reviews suggestions, accepts/edits, commits as new `field_mappings` rows linked to concepts

**Target**: onboarding time 4h → 30min. This is the single biggest capacity unlock — without it, going from 20 → 100 clients means ~320 hours of onboarding per analyst even if corrections go to zero.

### 4. Confidence Tracking

Each `field_mappings` row carries a rolling `confidenceScore`, updated every time an extraction uses that mapping.

**Formula**:

```
confidence = (correct_extractions / total_extractions) * recency_weight

where recency_weight decays older quarters:
  recency_weight(q) = 0.7 + 0.3 * exp(-0.5 * quarters_since_last_verified)
```

Seeded at 0.5 for new mappings. Bumped on analyst approval, penalized on analyst correction.

**Thresholds**:

| Confidence | Behavior |
|---|---|
| **> 0.95** | Auto-approve, hidden from the default review view, collapsed as "N values auto-approved" |
| **0.7 – 0.95** | Shown with green highlight, one-click accept |
| **< 0.7** | Shown with yellow warning, prefilled with the extracted value but flagged for explicit attention |

**Learning**:
- Every correction decreases confidence on the current mapping AND creates a `mappingHistory` row
- Every approval increases confidence and updates `lastVerifiedAt`
- A mapping whose correction count exceeds a threshold (e.g. 3 corrections in 2 quarters) is auto-flagged for restructuring (the label almost certainly drifted)

### 5. Review UI Changes

The current review UI shows every extracted value on every run. The analyst scrolls through all 41 LREN3 values even when 38 of them are identical to last quarter and obviously correct. That is the core of the bottleneck.

**New filtered review view**:

- **Default tab: "Needs review"**
  - All values with confidence < 0.95
  - All values on new or changed mappings
  - All values flagged by adversarial validation
  - All values with sign/unit mismatches
- **Collapsed bar: "37 values auto-approved — click to expand"**
  - Still visible on demand, still editable, but one interaction out of the way
- **"New aliases learned" side panel**
  - Labels the system matched for the first time this quarter
  - Analyst confirms/rejects → becomes a permanent alias

Goal: in the happy case, the analyst opens a quarter's review, sees 3–5 items, resolves them, and approves. The auto-approved set is there if they want it but does not steal attention.

---

## Rollout

Order matters — each phase is independently shippable and reversible.

1. **Data model migration** (new tables + new columns, all nullable). No behavior change.
2. **Seed canonical concepts + backfill aliases** for the 7 existing companies. Read-only check: every existing mapping now has a `conceptId`.
3. **Extraction alias lookup** wired behind a feature flag. Compare against label-matching output on the same run, log divergences. Roll out per-company once divergence is zero.
4. **Confidence scoring + history writes** on every extraction. No UI yet — just accumulate data for one cycle to calibrate thresholds.
5. **Review UI filtered view**. This is the moment the analyst feels the change.
6. **Onboarding suggester** (similarity + suggested mappings). Ship last — it needs the alias table to be populated, which step 2 handles, and it needs confidence scores to rank suggestions, which step 4 handles.

Every phase leaves the system strictly better or unchanged; there is no "big bang" cutover.

---

## Out of Scope (explicitly)

- **Full LLM Wiki v2 agentmemory pattern**. We pulled the useful ideas (semantic layer, alias learning, confidence) and dropped the generic tag graph — our domain is narrow enough that canonical concepts + aliases are sufficient.
- **Auto-extraction of brand-new concepts**. If an analyst sees a label that does not match any concept, we log and flag it, but a human decides whether it deserves a new canonical concept. The concept dictionary stays curated.
- **Cross-tenant learning**. All aliases are scoped to our own tenant. No sharing across customers.
- **Non-financial document memory**. Scope is strictly the Report Populator extraction path.

---

## Success Criteria

- Analyst corrections per company per quarter: **15–30 → 3–5**
- Company onboarding time: **4h → 30min**
- Analyst capacity: **20 → 100 clients** each
- Zero regressions on the 7 existing companies' current extraction accuracy
- Every correction recorded in `mapping_history` with reason
- Alias table grows monotonically across quarters (measurable compound learning)
