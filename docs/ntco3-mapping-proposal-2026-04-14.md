# NTCO3 rule-based coverage proposal — 2026-04-14

## Problem

NTCO3 (Natura & Co) currently catches **1/5 non-clean corruptions** in
the eval harness. Every other company in the corpus catches at least
3/5. The gap is that the existing `gross_profit` arithmetic constraint
can't fire on NTCO3 because Natura's mapping set has no Net Revenue or
Gross Profit result rows — only the raw inputs (Gross revenues,
Deductions, COGS) and the Net Income bottom line.

With no Net Revenue or Gross Profit, the constraint
`Gross Profit = Net Revenue − Cost of Sales`
can't assemble enough terms to evaluate, so `termsFound < 2` silently
skips the check. Every corruption on a NTCO3 row slips through the
rule-based layer, and the adversarial LLM layer doesn't fire either
because `shouldTriggerAdversarial` returns false on NTCO3's clean
high-confidence runs.

See `docs/eval-baseline-2026-04-14.md` for full context. This gap is
the single biggest remaining lever on the corpus-wide stable
aggregate catch rate (currently 70%, would move toward 90% if fixed).

## Good news: the template already has the rows

Downloaded and inspected the Natura template
(`https://rnsbkyuol74lbgv8.public.blob.vercel-storage.com/templates/8/NATURA_limpo.xlsx`).
The PROJ sheet has explicit Net Revenue and Gross Profit rows that
are NOT currently mapped:

| PROJ row | Label (Portuguese) | Sample value | Status |
|---|---|---|---|
| B3 | Receita Bruta | 2205.84 | ✅ already mapped (id=114) |
| B4 | Impostos e Ajustes | -564.04 | ✅ already mapped (id=115) |
| **B5** | **Receita Líquida** | **1641.80** | **❌ gap — add mapping** |
| B7 | CPV | -495.17 | ✅ already mapped (id=116) |
| **B8** | **Lucro Bruto** | **1146.63** | **❌ gap — add mapping** |
| B21 | EBIT | 228.73 | optional — would enable operating_income constraint |
| B32 | EBT | 174.03 | optional — would enable net_income constraint |
| B42 | Lucro Líquido Reportado | | ✅ already mapped as id=127 (Net income) |

**Arithmetic balances exactly:**

- Net Revenue = Receita Bruta − Impostos = 2205.84 − 564.04 = **1641.80** ✓
- Gross Profit = Receita Líquida − CPV = 1641.80 − 495.17 = **1146.63** ✓

No residual, no tolerance needed. The existing `gross_profit`
constraint at 1% tolerance will fire cleanly.

## Script I ran

`scripts/inspect-natura-template.ts` — downloads and inspects the
template, scans columns A-C for IS-line keywords, and prints candidate
rows with sample values. Read-only, no DB writes.

```bash
curl -sSL -o /tmp/NATURA_limpo.xlsx \
  "https://rnsbkyuol74lbgv8.public.blob.vercel-storage.com/templates/8/NATURA_limpo.xlsx"
pnpm tsx scripts/inspect-natura-template.ts
```

## Proposed changes (for Camila to approve)

Two new rows in `field_mappings` for `company_id=8` (Natura):

### Mapping 1: Net Revenue

```sql
INSERT INTO field_mappings (
  company_id, col_mode, source_section, source_label, source_row, source_col,
  target_sheet, target_row, target_col_base, target_col_step,
  base_quarter, expected_currency, validation_sign, is_active,
  concept_id, confidence_score
) VALUES (
  8, 'quarterly', 'Full model', 'Net revenue', 'Q4-25', NULL,
  'PROJ', 5, 'C', 1,
  'Q4-25', 'BRL', 'positive', true,
  1, 0.5  -- concept_id=1 is Net Revenue in canonical_concepts
);
```

### Mapping 2: Gross Profit

```sql
INSERT INTO field_mappings (
  company_id, col_mode, source_section, source_label, source_row, source_col,
  target_sheet, target_row, target_col_base, target_col_step,
  base_quarter, expected_currency, validation_sign, is_active,
  concept_id, confidence_score
) VALUES (
  8, 'quarterly', 'Full model', 'Gross profit', 'Q4-25', NULL,
  'PROJ', 8, 'C', 1,
  'Q4-25', 'BRL', 'positive', true,
  4, 0.5  -- concept_id=4 is Gross Profit in canonical_concepts
);
```

I copied the column layout and target-coord convention from the
existing Natura mappings (ids 114-127). Every field matches the
existing pattern except `source_label`, `target_row`, `concept_id`,
and the values themselves.

## Expected impact

Once these two mappings exist and the next NTCO3 extraction runs,
`extracted_values` will contain rows for Net revenue and Gross profit
alongside the existing 14 Natura rows. Then:

1. **`gross_profit` constraint fires on NTCO3**, matching
   `Receita Líquida - CPV = Lucro Bruto`. No tolerance issues — the
   math balances exactly.
2. **`shouldTriggerAdversarial` returns true** on any corruption that
   produces a violation, so the LLM critic path opens up too.
3. **Eval catch rate projection for NTCO3:**
   - `sign_flip` stays at 100% (basic validator via `validation_sign`)
   - `magnitude_1000x` → likely 100% (constraint violation + critic)
   - `decimal_shift` → likely 75-100% (depends on which row picker
     lands on and whether the decimal shift breaks the constraint)
   - `row_swap` → likely 100% (swapping Net Revenue with COGS breaks
     arithmetic)
   - `zero_wipe` → likely 100% (zero on any of the three terms
     breaks arithmetic)
4. **Corpus aggregate goes from 70% to ~90%** (NTCO3 lifts from 1/5
   to 4-5/5).

## Why I'm NOT shipping this autonomously

Three reasons:

1. **Mapping additions affect the review UI.** If Camila opens a
   NTCO3 run tomorrow and sees two new yellow rows she doesn't
   recognize ("where did Net Revenue and Gross Profit come from?"),
   that erodes trust. She should know before they show up.

2. **The new mappings need an extraction re-run to populate values.**
   Run 51 (the latest NTCO3 run in the eval corpus) was extracted
   with 14 values. Adding mappings doesn't retroactively populate
   them — they'll only appear starting from the next fresh extraction.
   Camila should run a fresh NTCO3 extraction after the mappings are
   added, and verify the new rows got sensible values, before we
   re-baseline.

3. **The pattern for other companies (LREN3, BIMBO, KIMBER).** If
   the same gap exists for them, applying the same fix is
   straightforward but should be done with Camila's review. I'd
   rather propose once and have her sign off on the pattern than
   push changes to 4 companies at once.

## What I'd like from Camila

1. **Open the Natura template** and confirm that PROJ!B5 is the
   canonical Net Revenue cell and PROJ!B8 is Gross Profit (should
   take 30 seconds, the labels are clear).
2. **Approve adding the two mappings** via the existing
   `scripts/setup-natura.ts` pattern, or let me script and apply
   them.
3. **Run a fresh NTCO3 extraction** (`pnpm tsx scripts/e2e-ntco3.ts`)
   to populate the new mappings with actual values.
4. **Re-run the eval harness** (`pnpm tsx scripts/eval-validator-harness.ts 29 16 <new-ntco3-run-id> 12`)
   to confirm NTCO3 catch rate went up.

Total elapsed time: ~5 minutes if the template matches expectations.

## Reference: the bigger pattern

If this works for NATURA, the same inspection pattern (download
template, scan for Net Revenue / Gross Profit / EBIT labels, add
mappings where missing) can be applied to:

- **LREN3 (Lojas Renner)** — currently has no Net Revenue or Gross
  Profit in the mapping set. Same gap.
- **BIMBO** — unknown, needs the same inspection. I didn't verify
  this session.
- **KIMBER** — unknown.
- **ENELCHILE** — already has `Ingresos de actividades ordinarias`
  and `Margen de contribución` mapped (I added label support for
  these in commit 1e5ef20). Coverage via label expansion alone.

A follow-up session could run `scripts/inspect-natura-template.ts` as
a generic template inspector pointed at each company's template URL.
I'd copy it to `scripts/inspect-company-template.ts` and make the
blob URL + sheet name configurable.
