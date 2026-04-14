# Adversarial validator eval — 2026-04-14, smarter victim picker

Sixth run of `scripts/eval-validator-harness.ts`, after upgrading the
harness to prefer constraint-adjacent victims over "first non-zero row"
(see post-W1.7 verdict in `docs/eval-baseline-2026-04-13-post-w1-7.md`).

Previous baselines:
- `docs/eval-baseline-2026-04-13.md` (initial, first-non-zero picker)
- `docs/eval-baseline-2026-04-13-post-w1-{4,5,6,7}.md`

## Why the harness changed

Every prior baseline used `findIndex(non_zero_value)` to pick the
corruption victim. For all four default runs that happened to land on a
row that wasn't part of any arithmetic constraint — so catch rate was
measuring "how often did we get lucky enough to corrupt a constrained
row by accident." It should have been measuring "given a constrained
row, does the validator catch the corruption."

New picker (`pickConstrainedVictim`) walks each run's values and
returns the first row whose label matches any term or result label
from the active constraint set via `labelMatches` (prefix match on
lowercased normalized label). Falls back to first-non-zero only when
no constraint-adjacent row exists.

The `target` field on every result records which picker was used
(`constrained` | `uncovered`). All 24 cases in this baseline hit
`constrained` because every run in the corpus has at least one row
that label-matches — though as shown below, "label matches" does NOT
mean "constraint actually fires."

## Headline numbers

| metric | initial | W1.6 | W1.5 | W1.4 | W1.7 | **W1.7 + smart picker** |
|---|---|---|---|---|---|---|
| Error rate | 12.5% | 4% | 0% | 0% | 0% | **0%** |
| False positive rate | 25% | 50% | 25% | 25% | 0% | **0%** |
| Sign flip catch rate | 50% | 50% | 25% | 50% | 25% | **0%** |
| Decimal shift catch rate | 50% | 0% | 50% | 0% | 0% | **25%** |
| Row swap catch rate | 50% | 50% | 50% | 25% | 50% | **50%** |
| Magnitude ×1000 catch rate | 25% | 25% | 50% | 50% | 0% | **50%** |
| Zero wipe catch rate | 25% | 50% | 25% | 50% | 0% | **25%** |

Aggregate non-clean catch rate: **30%** (up from 25% post-W1.7).
False positives still 0%. Errors still 0%.

## The CENT result is the real story

| run | company | corruption | target | status | violations | detail |
|---|---|---|---|---|---|---|
| 29 | CENT | clean | constrained | pass | 0 | unmodified |
| 29 | CENT | sign_flip | constrained | **pass** | 0 | flipped Net revenue: 2427832 → -2427832 |
| 29 | CENT | magnitude_1000x | constrained | **needs_review** | 1 | ×1000 on Net revenue |
| 29 | CENT | decimal_shift | constrained | **needs_review** | 1 | ÷10 on Net revenue |
| 29 | CENT | row_swap | constrained | **needs_review** | 1 | Net revenue ↔ Gross revenue |
| 29 | CENT | zero_wipe | constrained | **needs_review** | 1 | Net revenue → 0 |

**CENT catches 4 of 5 non-clean corruptions on a constraint input —
that's 80% precision with 0% false positives on the same run.** This
is the validator working exactly as designed: the new picker lands on
`Net revenue` (gross_profit term), the magnitude/decimal/row_swap/zero
corruptions each violate `Net revenue - Cost of sales ≈ Gross profit`,
and the rule-based constraint check triggers the LLM critic which
returns `needs_review`.

The one miss is sign_flip, and it's a structural limitation, not a
tuning issue. See next section.

## Sign flip is invisible to flow-based arithmetic

W1.7 replaced `coefficient: +1/-1` with `flow: "inflow"/"outflow"/"signed"`
in `constraints.ts` to handle companies that store costs with different
sign conventions. The implementation uses `+|value|` for inflows and
`-|value|` for outflows — i.e., it takes the absolute value and reapplies
the expected accounting sign. This was correct for the bug it fixed
(CENT's sign-convention false positive) but introduces a blind spot:

When the harness flips Net revenue from `2427832` to `-2427832`, the
constraint computes `+|−2427832| - |−1274693| = 1153139`, which equals
the stored Gross profit. No violation, no trigger, no catch.

**Fix option A:** Add a parallel "sign check" validator that asserts
expected-sign invariants per concept (revenue ≥ 0, expenses ≥ 0 or ≤ 0
depending on company convention). Implementation: `mapping.validationSign`
already exists (it's populated on some mappings) — currently only the
basic validator checks it. Promote it to constraint-level so it fires
even on high-confidence rows that don't otherwise trip `shouldTriggerAdversarial`.

**Fix option B:** Use the raw signed value for terms marked `flow: "inflow"`
when the sign disagrees with the accounting direction. Only works if we
know the company's storage convention; we currently don't record it.

Option A is simpler and more surgical. Left as follow-up.

## REGIONAL and NTCO3 land on label false positives

The new picker also found a latent defect in the revenue label pattern:

```
Net Revenue|Receita Líquida|Revenue|Ingresos|Receita
```

`"Ingresos"` is too generic. `labelMatches` uses prefix matching, so
`"Ingresos por intereses"` (interest income, a BANREGIO bank line)
starts with `"Ingresos"` → matches. The picker thought it found
a revenue row; the constraint check then didn't find a matching
Cost of Sales or Gross Profit (because BANREGIO doesn't report either),
so `termsFound < 2` and the constraint silently didn't fire. Same
story for ENELCHILE picking `Ingresos financieros` (financial income,
not revenue).

NTCO3 picks `COGS` as its victim (matches `Cost of Sales|...|COGS`).
That's a genuine cost of sales line, but NTCO3's net revenue is stored
under a label that doesn't prefix-match `Net Revenue`, so the
gross_profit constraint can't build. Again, silent no-op.

Result: 0 violations on 15 cases (3 companies × 5 non-clean). The
validator isn't broken, it's just inert when the pattern dictionary
is incomplete for the company.

**Fix option:** Rewrite the revenue pattern as
`Net Revenue|Revenue|Receita|Ingresos de Actividades Ordinarias|Ingresos de Operación|Revenues`
— drop the bare `"Ingresos"` alternative. For BANREGIO specifically, banks
need a separate `BANK_INCOME_CONSTRAINTS` set (`Interest income`,
`Fees`, `Net interest margin`, etc.) since `gross_profit = revenue − cogs`
doesn't exist in banking. Left as follow-up — it's expansion, not a
bug fix.

## ENEL shows the LLM path alive

ENEL has 12 mappings with confidence 0.75-0.9 (the three pass-3 fuzzy
matches and overnight-seeded concept aliases), so
`shouldTriggerAdversarial` returns true even when violations=0. The
LLM critic runs on every case and catches 2 of 5 corruptions
(magnitude_1000x, row_swap). Sign flip, decimal shift, and zero wipe
slip through.

That's the LLM critic's floor: ~33% recall when the rule-based layer
is silent. Which is why W3.1 was scoped as "critic fidelity" — better
critic ≈ better floor.

## Verdict: W3.1 is still deprioritized

The CENT result proves the rule-based path is the dominant mechanism.
When it fires, catch rate jumps to 80%. When it doesn't, catch rate
falls to 0% (BANREGIO, NTCO3) or the LLM floor of ~33% (ENEL). No
amount of Author-B / Synthesizer / randomized judge ordering changes
the fact that **the rule-based layer is silent for 3 of 4 companies
in this corpus**.

The path to higher catch rate is not W3.1. It is:

1. **Fix the `"Ingresos"` false match** — one-line pattern change in
   `constraints.ts`. Eliminates the silent false-label-match misses on
   REGIONAL and ENELCHILE.
2. **Add sign check as a parallel constraint** — pulls sign flip from
   0% to ~100% without touching the flow abstraction. `mapping.validationSign`
   is already populated for some rows.
3. **Expand constraint dictionaries per industry** — banking, retail, and
   utilities each have different canonical aggregations. A single
   `INCOME_STATEMENT_CONSTRAINTS` set can't cover all of them.
4. **Only after 1-3**: re-baseline, then consider W3.1 if aggregate
   catch rate is still below 60%.

## Raw eval output

Full per-case table lives in `/tmp/eval-output.md` from the run at
`2026-04-14T10:03:56Z`. Corpus: CENT run 29, BANREGIO run 16, NTCO3
run 49 (fresh), ENELCHILE run 12. 24 cases total, 155s wall time, 42
judge votes.
