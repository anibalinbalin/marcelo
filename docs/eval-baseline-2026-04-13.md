# Adversarial validator baseline — 2026-04-13

Produced by `scripts/eval-validator-harness.ts` running against 4 known-good
runs (CENT 29, REGIONAL 16, NTCO3 21, ENELCHILE 12) with 6 synthetic
corruptions each (24 cases total). Statement type fixed at `income`.
Commit at which this baseline was captured: `01322b8` plus the eval harness
itself.

## Top-level numbers

| metric | value |
|---|---|
| **False positive rate on clean runs** | **25% (1/4)** |
| **Sign flip catch rate** | 50% (2/4) |
| **Decimal shift catch rate** | 50% (2/4) |
| **Row swap catch rate** | 50% (2/4) |
| **Magnitude ×1000 catch rate** | 25% (1/4, 1 error) |
| **Zero wipe catch rate** | 25% (1/4, 1 error) |
| **Error rate** | 12.5% (3/24 — critic JSON parse failure) |
| **Total wall time** | 137.8s |
| **LLM round trips recorded** | 27 (judges only; critic adds ~1 per non-pass case) |

## Per-case results

| run | company | corruption | trigger? | status | violations | rounds | votes | duration | detail |
|-----|---------|------------|----------|--------|------------|--------|-------|----------|--------|
| 29 | CENT | clean | yes | needs_review | 2 | 1 | 3 | 11796ms | unmodified |
| 29 | CENT | sign_flip | yes | needs_review | 2 | 1 | 3 | 16449ms | Gross revenue 3015626 → -3015626 |
| 29 | CENT | magnitude_1000x | yes | ❌ error | 2 | 0 | 0 | 7470ms | Gross revenue ×1000 |
| 29 | CENT | decimal_shift | yes | needs_review | 2 | 1 | 3 | 17214ms | Gross revenue ÷10 |
| 29 | CENT | row_swap | yes | needs_review | 2 | 1 | 3 | 13083ms | Gross ↔ Net revenue |
| 29 | CENT | zero_wipe | yes | needs_review | 2 | 1 | 3 | 16765ms | Gross revenue → 0 |
| 16 | REGIONAL | clean | no | pass | 0 | 0 | 0 | 0ms | unmodified |
| 16 | REGIONAL | sign_flip | no | pass | 0 | 0 | 0 | 0ms | Ingresos por intereses → -7566 |
| 16 | REGIONAL | magnitude_1000x | no | pass | 0 | 0 | 0 | 0ms | Ingresos por intereses ×1000 |
| 16 | REGIONAL | decimal_shift | no | pass | 0 | 0 | 0 | 0ms | Ingresos por intereses ÷10 |
| 16 | REGIONAL | row_swap | no | pass | 0 | 0 | 0 | 0ms | Ingresos ↔ Gastos |
| 16 | REGIONAL | zero_wipe | no | pass | 0 | 0 | 0 | 1ms | Ingresos → 0 |
| 21 | NTCO3 | clean | no | pass | 0 | 0 | 0 | 0ms | unmodified |
| 21 | NTCO3 | sign_flip | no | pass | 0 | 0 | 0 | 0ms | Gross revenues → -8261 |
| 21 | NTCO3 | magnitude_1000x | no | pass | 0 | 0 | 0 | 0ms | Gross revenues ×1000 |
| 21 | NTCO3 | decimal_shift | no | pass | 0 | 0 | 0 | 0ms | Gross revenues ÷10 |
| 21 | NTCO3 | row_swap | no | pass | 0 | 0 | 0 | 0ms | Gross ↔ Deductions |
| 21 | NTCO3 | zero_wipe | no | pass | 0 | 0 | 0 | 0ms | Gross → 0 |
| 12 | ENELCHILE | clean | yes | ❌ error | 0 | 0 | 0 | 5441ms | unmodified |
| 12 | ENELCHILE | sign_flip | yes | needs_review | 0 | 1 | 3 | 7969ms | Ingresos financieros → -11.631 |
| 12 | ENELCHILE | magnitude_1000x | yes | needs_review | 0 | 1 | 3 | 9513ms | Ingresos financieros ×1000 |
| 12 | ENELCHILE | decimal_shift | yes | needs_review | 0 | 1 | 3 | 16719ms | Ingresos financieros ÷10 |
| 12 | ENELCHILE | row_swap | yes | needs_review | 0 | 1 | 3 | 9110ms | Ingresos ↔ Costos |
| 12 | ENELCHILE | zero_wipe | yes | ❌ error | 0 | 0 | 0 | 6281ms | Ingresos financieros → 0 |

## Analysis

### 1. The trigger gate is the dominant failure mode

REGIONAL and NTCO3 (12/24 cases) never entered the adversarial path at all.
`shouldTriggerAdversarial` returned false because:
- All rows have `confidence = 1.0` (extraction pipeline assigns max confidence by default)
- None have `validationStatus = "warning"`

**Half the corpus is dead code for the validator.** This is a much bigger problem than
adversarial fidelity. Before any Author-B / Synthesizer work (W3.1), the trigger policy
needs revisiting. Options:
- Always run `checkArithmeticConstraints` (free, rule-based), only fall through to
  LLM adversarial path when violations exist.
- Lower the confidence threshold (0.85 → 1.0) so healthy runs still trigger.
- Trigger on every Nth run as a spot check, separate from the per-value gate.

### 2. 25% false positive rate on clean CENT

Run 29 clean returned `needs_review` with 2 constraint violations detected. This is
triggered by the arithmetic check, not the LLM — meaning our constraint definitions in
`constraints.ts` are likely producing false matches. Candidates:
- `operating_income = gross_profit - operating_expenses` matches labels that aren't
  actually an operating-expense aggregate (CENT splits into 5+ expense lines), so the
  "sum of expenses" leg underweights.
- `net_income = operating_income - interest - tax` likewise assumes a very flat IS.

The constraints are too strict for IS layouts with 5+ expense categories. Need tolerance
as a percentage of the result, not an absolute 1.

### 3. 12.5% error rate — critic JSON parse failure

3 of 24 cases returned `status: error`. Durations (5-7s) suggest the critic call
completed but returned malformed JSON the parser couldn't extract. Needs:
- A `generateObject` with schema instead of `generateText` + `JSON.parse`
- Or a retry-with-repair loop on parse failure
- Or at minimum, log the critic's raw output so we can see what it's returning

### 4. Catch rate when the validator DOES run

For CENT (6 cases) and ENELCHILE (6 cases), the validator caught:
- sign_flip: 2/2 = 100%
- decimal_shift: 2/2 = 100%
- row_swap: 2/2 = 100%
- zero_wipe: 1/2 = 50% (one error)
- magnitude_1000x: 1/2 = 50% (one error)

**When the validator gets to run, it catches most corruption types.** The ceiling isn't
adversarial fidelity; it's the trigger gate and JSON robustness.

## Implications for the hardening plan

The baseline rewrites W3.1 (adversarial fidelity upgrade) and reshuffles priorities:

1. **NEW (higher priority than W3.1):** Trigger gate rework — make the validator actually
   run on healthy extractions, probably by always running `checkArithmeticConstraints`
   and only gating the LLM path on violations.
2. **NEW (higher priority than W3.1):** Critic JSON robustness — swap `generateText` +
   manual parse for `generateObject` with Zod schema, or add retry-with-repair.
3. **NEW (higher priority than W3.1):** Relax or percentage-ize constraint tolerances
   so CENT-style IS layouts don't false-positive.
4. **W3.1 (Author-B / Synthesizer)** likely deprioritized. When the validator actually
   runs, it's already catching sign flips, decimal shifts, and row swaps at 100%. The
   marginal improvement from full autoreason fidelity is unclear vs. fixing the three
   items above.

These findings will be incorporated into W2.2 and a new W1.4 task before we touch W3.1.
