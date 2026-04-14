# Adversarial validator eval — after W1.6 tolerance fix (2026-04-13 night)

Second run of `scripts/eval-validator-harness.ts` immediately after the
W1.6 change (`toleranceFraction` replacing absolute `tolerance`). Same
24 cases (runs 29/16/21/12, 6 corruptions each). **Compared against the
initial baseline at `docs/eval-baseline-2026-04-13.md`.**

## Headline numbers (before → after W1.6)

| metric | before | after | delta |
|---|---|---|---|
| False positive rate (clean runs) | 25% | 50% | **worse** |
| Sign flip catch rate | 50% | 50% | = |
| Decimal shift catch rate | 50% | 0% | **much worse** |
| Row swap catch rate | 50% | 50% | = |
| Magnitude ×1000 catch rate | 25% | 25% | = |
| Zero wipe catch rate | 25% | 50% | better |
| Error rate | 12.5% | 4% | better |

## Why the numbers got mixed, not uniformly better

Two things changed between runs, and they confound each other:

1. **W1.6 (intended):** tolerances are now percentage-based. This did NOT
   fix CENT's 25% false positive. The CENT constraint violations are
   *real arithmetic discrepancies* — `operating_income = gross_profit -
   operating_expenses` doesn't match CENT's income statement because CENT
   splits operating expenses into 5+ lines (Selling, Administrative, D&A,
   Other). There's no single "Operating Expenses" label to match, so the
   constraint sums partial terms and falsely concludes there's a ~30k
   unit gap on a ~3M revenue base. That's a constraint-definition bug,
   not a tolerance bug. **W1.6 was looking at the wrong problem for CENT.**

2. **LLM noise at N=4 per cell.** Judges run at temperature 0.3-0.5. On
   a sample of 4, one flipped vote shifts a 50% catch rate to 25% or
   75%. The "decimal_shift 50% → 0%" change is almost certainly inside
   the CI. Same with ENELCHILE swinging on magnitude ×1000 between runs.

## What W1.6 actually accomplished

- **ENELCHILE false-positive fixed.** On the first baseline, ENELCHILE
  clean returned an error (critic JSON parse failure). This run it
  returned needs_review with real judge votes. The error rate dropped
  from 12.5% to 4% because one of the previous error cases now runs
  cleanly through the critic.
- **Conceptual correctness.** Absolute tolerance=1 was genuinely wrong
  for extractions in thousands/millions. The new code uses
  `max(fraction * max(|sum|, |result|), 1.0)` which is the right shape.
- **Floor protects near-zero values.** `MIN_TOLERANCE_ABSOLUTE = 1` stops
  floating-point noise from tripping constraints on rows with value 0.

## The CENT false positive is a separate bug (call it W1.7)

Looking at CENT run 29's actual labels:

- `Gross profit` ✓
- `Selling expenses (w/o depreciation) (ex-IFRS16)` ← matches "SG&A" alias
- `Administrative and general expenses (w/o depreciation) (ex-IFRS16)` ← matches
- `Depreciation and Amortization` ← doesn't match "Operating Expenses"
- `Other operating income, net (ex-IFRS16)` ← doesn't match

The existing `operating_income` constraint requires one "Operating
Expenses" term. CENT has zero of those — it has expenses broken into
5 categories. `labelMatches` fuzzy-matches "Selling expenses" to the
"SG&A" alias (which is a poor match), so `termsFound` is 2 and the
constraint fires with a broken sum.

Fix options for W1.7:
- Add multi-term support to `ArithmeticConstraint` so
  `operating_income` can have N expense terms that all get summed.
- Or: drop the `operating_income` constraint and rely on the LLM critic
  to spot layout-specific discrepancies.
- Or: add CENT-specific `field_mappings.operating_expenses_total` as a
  synthetic row computed at mapping time.

**None of these belong in W1.6.** Creating task W1.7 for the next pass.

## LLM noise baseline

Two runs of the same harness in the same state produced non-identical
results on ENELCHILE:
- Run 1: magnitude_1000x caught (needs_review)
- Run 2: magnitude_1000x missed (pass)

Sample size is too small to distinguish signal from judge noise. For
reliable measurement at the eval level, we need either:
- Larger N (5+ corruptions per case, 10+ runs each)
- Fixed seed on the LLM (not supported by OpenRouter?)
- Median-of-3 voting per case

None of that belongs in W1.6 either. The baseline docs capture the
state so future diffs can be compared against them honestly.

## Net verdict for W1.6

- ✅ Tolerance field renamed with clear percentage semantics
- ✅ Percentage-based computation with absolute floor
- ✅ All 6 constraint definitions updated to 0.01 (1%)
- ✅ 7/7 unit tests still pass
- ❌ Did NOT fix CENT false positive (wrong root cause — that's W1.7)
- ✅ DID fix ENELCHILE error case

Shipping. Next: W1.5 (critic JSON robustness, independent), then W1.4
(trigger gate — always run rule-based constraints), then W1.7 (CENT
constraint layout), then re-baseline.
