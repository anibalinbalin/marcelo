# Adversarial validator eval — after W1.4 trigger gate rework (2026-04-13 night)

Fourth run of `scripts/eval-validator-harness.ts`, after moving the
rule-based `checkArithmeticConstraints` call into
`shouldTriggerAdversarial` so the gate can fire on arithmetic violations,
not just on basic-validation warnings / low confidence.

Comparing against:
- `docs/eval-baseline-2026-04-13.md` (initial)
- `docs/eval-baseline-2026-04-13-post-w1-6.md` (percentage tolerance)
- `docs/eval-baseline-2026-04-13-post-w1-5.md` (JSON robustness)

## Headline numbers

| metric | initial | W1.6 | W1.5 | **W1.4** |
|---|---|---|---|---|
| Error rate | 12.5% | 4% | 0% | **0%** |
| False positive rate | 25% | 50% | 25% | **25%** |
| Sign flip catch rate | 50% | 50% | 25% | **50%** |
| Decimal shift catch rate | 50% | 0% | 50% | **0%** |
| Row swap catch rate | 50% | 50% | 50% | **25%** |
| Magnitude ×1000 catch rate | 25% | 25% | 50% | **50%** |
| Zero wipe catch rate | 25% | 50% | 25% | **50%** |

Aggregate non-clean catch rate:
- initial: 9/20 = 45%
- post-W1.6: 7/20 = 35%
- post-W1.5: 8/20 = 40%
- **post-W1.4: 7/20 = 35%**

Still inside the ±10% noise band that N=4 produces. Zero errors
preserved from W1.5.

## What W1.4 actually changed

`shouldTriggerAdversarial` now runs `checkArithmeticConstraints` first and
returns `true` on any violation, falling back to the
warnings/low-confidence check only when constraints are satisfied.
The pipeline caller derives `statementType` from `targetSheet` before the
gate so the right constraint set is consulted.

This is a **correct and load-bearing** change for any future IFRS-shaped
company that extracts cleanly (confidence 1.0, no basic-validation
warnings) but happens to ship a real arithmetic discrepancy. Before W1.4,
that run would silently pass. After W1.4, it triggers the LLM debate.

The refactor also unblocks W1.7: any constraint improvement now
propagates directly into gate behavior, not just into
`runAdversarialValidation`'s internal short-circuit.

## What W1.4 did NOT fix: the REGIONAL/NTCO3 dead zone

The initial baseline flagged REGIONAL (run 16) and NTCO3 (run 21) as
"never entering the adversarial path". I expected W1.4 to rescue them by
firing the gate on constraint violations. It didn't:

| run | corruption | trigger? | violations |
|---|---|---|---|
| 16 REGIONAL | sign_flip | **no** | 0 |
| 16 REGIONAL | magnitude_1000x | **no** | 0 |
| 16 REGIONAL | zero_wipe | **no** | 0 |
| 21 NTCO3 | sign_flip | **no** | 0 |
| 21 NTCO3 | row_swap | **no** | 0 |
| 21 NTCO3 | zero_wipe | **no** | 0 |

Why zero violations even after corruption? Because our constraint set
assumes IFRS/GAAP standard income statement labels — `Revenue`, `Cost of
Sales`, `Gross Profit`, `Operating Expenses`, `Operating Income`, `EBIT`.

- **REGIONAL** is a bank. Its corruption target is "Ingresos por
  intereses" — interest income. We have no bank-income-statement
  constraint. The closest one would be
  `net_interest_income = interest_income - interest_expense`, which
  doesn't exist in `INCOME_STATEMENT_CONSTRAINTS`.
- **NTCO3** uses "Gross revenues" and "Deductions" (Brazilian IFRS label
  flavor). `labelMatches` fuzzy-matches `Gross revenues` to our
  `Revenue` alias, but there is no "Deductions" → "Cost of Sales"
  matcher, so `gross_profit` only finds 1 of 3 terms and the constraint
  is skipped (the code requires ≥2 terms to fire).

The REGIONAL/NTCO3 dead zone is a **constraint coverage problem**, not a
gate problem. W1.7 (multi-term constraints + bank-shape constraints) is
the real fix. W1.4 is necessary but not sufficient.

## What W1.4 DID fix (latent, not yet observable in N=4)

Any clean healthy extraction from an IFRS company (revenue, COGS, gross
profit all present with standard labels) that ships a real arithmetic
discrepancy will now trigger. Our eval corpus happens to not contain that
case today — CENT already triggered via its pre-existing false-positive
violations, ENELCHILE already triggered via low-confidence on Ingresos
financieros. The improvement is real but latent; we'll see it when W1.7
expands constraint coverage and when a new healthy IFRS company lands.

## Catch-rate swings are noise

- decimal_shift: 50% → 0%, sign_flip: 25% → 50%, row_swap: 50% → 25%.
  Classic N=4 LLM-noise jitter. No code path affecting this changed
  between W1.5 and W1.4.
- decimal_shift 0/4 has a coherent explanation independent of noise:
  dividing a 11.631 value by 10 is below any reasonable tolerance, and
  CENT's pre-existing CENT false-positive violations are unrelated to
  the injected corruption so the critic anchors on the wrong thing.

## Verdict for W1.4

- ✅ 9/9 unit tests pass (added `triggers on constraint violation with
  clean basic status`).
- ✅ Zero parse errors preserved.
- ✅ Gate now runs constraints — correct shape.
- ✅ Pipeline caller refactored to derive `statementType` before the gate.
- ❌ Does NOT rescue REGIONAL/NTCO3 — that's a constraint coverage
  problem (W1.7), not a gate problem.
- ~ Catch rate unchanged within noise.

Shipping. Next: W1.7 (constraint coverage — either multi-term support for
IFRS income statements with split expense lines, or bank-shape
constraints for REGIONAL, or drop over-specific constraints in favor of
LLM-based layout inference).
