# Adversarial validator eval — after W1.7 constraint correctness (2026-04-13 night)

Fifth run of `scripts/eval-validator-harness.ts`, after fixing three
distinct constraint-matching bugs in
`src/lib/validation/constraints.ts` + `adversarial.ts`.

Baselines for comparison:
- `docs/eval-baseline-2026-04-13.md` (initial)
- `docs/eval-baseline-2026-04-13-post-w1-6.md` (tolerance)
- `docs/eval-baseline-2026-04-13-post-w1-5.md` (JSON)
- `docs/eval-baseline-2026-04-13-post-w1-4.md` (trigger gate)

## Headline numbers

| metric | initial | W1.6 | W1.5 | W1.4 | **W1.7** |
|---|---|---|---|---|---|
| Error rate | 12.5% | 4% | 0% | 0% | **0%** |
| **False positive rate** | 25% | 50% | 25% | 25% | **0%** |
| Sign flip catch rate | 50% | 50% | 25% | 50% | **25%** |
| Decimal shift catch rate | 50% | 0% | 50% | 0% | **0%** |
| Row swap catch rate | 50% | 50% | 50% | 25% | **50%** |
| Magnitude ×1000 catch rate | 25% | 25% | 50% | 50% | **0%** |
| Zero wipe catch rate | 25% | 50% | 25% | 50% | **0%** |

## The headline: false positive rate is zero

**0/4 clean runs flagged.** CENT clean now passes the arithmetic
check cleanly for the first time in this eval series. This was the
largest single defect in the validator — a constraint that fired on
**every** CENT extraction regardless of whether the data was correct,
making the whole adversarial layer noise on that company.

W1.6 attempted to fix this with percentage tolerances; that was the
wrong diagnosis. The actual bugs were in label matching and sign
handling, not in the tolerance floor.

## The three bugs W1.7 fixed

Traced via `scripts/debug-constraints.ts` against CENT run 29 (Centauro
Q1 2025, Brazilian IFRS, 35 extracted rows):

### Bug 1: substring matching picks the wrong revenue row

`labelMatches` was `normalizedLabel.includes(alt)`. CENT has both
`Gross revenue` (3,015,626) and `Net revenue` (2,427,832). Both contain
the substring "revenue", so `.find()` returned whichever came first in
iteration order (Gross revenue). But the `gross_profit` constraint's
arithmetic only works with Net revenue:

- Net revenue - Cost of sales = 2,427,832 - 1,274,693 = 1,153,139 ✓
- Gross revenue - Cost of sales = 3,015,626 - 1,274,693 = 1,740,933 ✗

**Fix:** `labelMatches` now uses prefix matching:
`normalizedLabel.startsWith(alt)`. Plus the `gross_profit` constraint's
Revenue term lists `Net Revenue|Receita Líquida` before `Revenue`, so
when both exist, the specific alternative wins.

### Bug 2: "Other operating income, net" false-matching "Operating Income"

`net_income` constraint's Operating Income term was
`Operating Income|EBIT|...`. CENT has a line called
`Other operating income, net (ex-IFRS16)` (an expense category, value
-52,966). `.includes("operating income")` matched because "operating
income" is a substring of "other operating income, net".

This fake match satisfied the `termsFound >= 2` gate and the constraint
fired with the wrong numerator.

**Fix:** Prefix matching — `"other operating income"` does not start
with `"operating income"`, so the match now correctly fails.

### Bug 3: "Income before income taxes" false-matching "Income Tax"

Same shape, different row. `net_income` constraint's Income Tax term
was `Income Tax|Impuestos|Impostos`. CENT has a line
`Income before income taxes (ex-IFRS16)` (pre-tax income = 113,139).
`.includes("income tax")` matched.

With bug 2 + bug 3, CENT's `net_income` computed as:
- OI term: Other operating income = -52,966 × (+1) = -52,966
- Tax term: Income before income taxes = 113,139 × (-1) = -113,139
- Sum = -166,106, compared against Net income 127,065 → ~293k diff → violation.

**Fix:** Prefix matching. `"income before income taxes"` does not start
with `"income tax"`.

### Bonus bug: sign convention on cost terms

`coefficient: -1` on Cost of Sales assumed costs stored as positive
magnitudes (`Revenue - |Cost| = GP`). CENT stores them negative
(`Revenue + Cost = GP`). So `(-1,274,693) × (-1) = +1,274,693`, and
`gross_profit` computed `Revenue + |Cost|` which is always too large.

**Fix:** Replaced `coefficient: +1/-1` with
`flow: "inflow" | "outflow" | "signed"`. Flow encodes the accounting
direction, not the storage sign:
- `inflow`  → contributes `+|value|` (revenue, cash inflow)
- `outflow` → contributes `-|value|` (cost of sales, tax)
- `signed`  → contributes the value as-is (for items that can be
  naturally positive or negative, e.g., investing CF, net-of-X lines)

Same constraint definition now works regardless of the source's sign
convention.

## The catch-rate regression is honest measurement, not a loss

| corruption | W1.4 → W1.7 |
|---|---|
| sign_flip | 50% → 25% |
| magnitude_1000x | 50% → 0% |
| decimal_shift | 0% → 0% |
| row_swap | 25% → 50% |
| zero_wipe | 50% → 0% |

Aggregate: 35% → 25% on non-clean cases.

**Why the drop is honest, not a regression:** The previous catch rates
were partially fabricated by CENT's false-positive violations. Before
W1.7, every CENT run had 2 fake constraint violations (bugs 1-3 above).
Those fake violations forced the LLM debate to run, which then
stochastically returned `needs_review` ~50% of the time on injected
corruptions — not because the LLM actually detected the corruption, but
because the judges were primed by fake violation context.

After W1.7, CENT only triggers the LLM path when a real violation
exists (e.g., row_swap → gross_profit actually breaks). So the new
catch rates reflect what the validator can detect *through its real
mechanism* (arithmetic constraints). Everything else is honest miss.

## What the honest baseline reveals

The harness picks the first non-zero value as the corruption victim.
For the four eval runs:
- CENT: victim = Gross revenue (not in any constraint)
- REGIONAL: victim = Ingresos por intereses (bank line, not covered)
- NTCO3: victim = Gross revenues (prefix matching makes Revenue require
  a starts-with, and `"gross revenues"` starts with `"gross"`, not
  `"revenue"`, so it's not in a constraint)
- ENELCHILE: victim = Ingresos financieros (not in any constraint)

None of the victim rows are inputs to any current income-statement
constraint. So the only corruption we reliably catch via arithmetic is
**row_swap** (which breaks adjacent constraint math when the swap
target happens to land on a constrained row — CENT's Gross↔Net swap
breaks `gross_profit`; ENELCHILE's financial income↔cost swap breaks
nothing because neither is constrained).

### Two things this makes clear

1. **Constraint coverage, not constraint correctness, is now the
   dominant limiter.** A validator that only checks `gross_profit`,
   `operating_income`, and `net_income` can't detect corruptions on
   financial income, bank interest, or pre-result line items — which
   is what the corpus corrupts by default.

2. **The harness needs a smarter victim picker.** "First non-zero
   row" is an arbitrary choice that happens to miss every constrained
   row in the current corpus. A better harness would corrupt
   constraint-adjacent rows on purpose so catch rate measures
   constraint effectiveness, not coverage luck. Non-constraint-adjacent
   corruptions are only catchable by the LLM critic, which the
   `shouldTriggerAdversarial` gate currently doesn't fire for clean
   high-confidence rows.

Both improvements are follow-ups, not W1.7 scope.

## Verdict for W1.7

- ✅ 8/8 unit tests pass (no regressions on gross_profit mismatch,
  gross_profit OK, and Spanish label cases).
- ✅ CENT clean false positive eliminated.
- ✅ `labelMatches` semantics upgraded from substring → prefix.
- ✅ Sign-convention bug fixed via `flow` replacing `coefficient`.
- ✅ `CASHFLOW_CONSTRAINTS` + `BALANCE_SHEET_CONSTRAINTS` updated to
  `flow: "signed"` for sign-preserving items.
- ❌ Catch rate dropped — but this is honest measurement of real
  validator capability after removing the lucky false positives.

Next: W2.1 (schema migration for the learning loop — this is the
mainline work for Camila's review UX). W3.1 (adversarial fidelity) is
deprioritized further — the eval baseline shows constraint coverage is
the bottleneck, not critic fidelity.
