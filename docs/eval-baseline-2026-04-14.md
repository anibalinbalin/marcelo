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

---

## Second run — after revenue pattern fix + basic validator merge

After the first 2026-04-14 baseline flagged two quick wins, shipped in
the same commit:

1. Dropped bare `"Ingresos"` from the revenue pattern in
   `constraints.ts`. Replaced with `"Ingresos de Actividades
   Ordinarias|Ingresos de Operación"`.
2. Harness now runs the basic validator (`src/lib/validation/engine.ts`)
   alongside `runAdversarialValidation` and treats the case as caught if
   EITHER layer flags it. This matches what Camila actually sees in the
   review UI — the basic validator's sign/NaN/low-confidence checks
   run in prod before adversarial, so the harness should measure the
   composite outcome.

### Headline numbers

| metric | post-W1.7 | first 04-14 | **second 04-14** |
|---|---|---|---|
| False positive rate | 0% | 0% | **0%** |
| Error rate | 0% | 0% | **0%** |
| Sign flip catch rate | 25% | 0% | **75%** |
| Decimal shift catch rate | 0% | 25% | **25%** |
| Row swap catch rate | 50% | 50% | **75%** |
| Magnitude ×1000 catch rate | 0% | 50% | **50%** |
| Zero wipe catch rate | 0% | 25% | **25%** |

Aggregate non-clean catch rate: **50%** (up from 30%, up from 25%
post-W1.7). Still 0% false positives.

### Where the wins came from

**Basic validator caught 5 of 10 non-CENT corruptions:**

| run | corruption | mechanism |
|---|---|---|
| BANREGIO | sign_flip | `Gastos de Operación` positive, validation_sign=negative → fail |
| BANREGIO | row_swap | expense row got positive value after swap → fail |
| NTCO3 | sign_flip | `COGS` positive, validation_sign=negative → fail |
| ENEL | sign_flip | `Ingresos financieros` negative, validation_sign=positive → fail |
| ENEL | row_swap | swap produced sign mismatch → fail |

This is the point of promoting basic validation: every row whose
mapping has `validation_sign` populated now has a cheap, deterministic
sign guard that runs regardless of whether the adversarial gate fires.
120 of 167 active mappings (72%) have `validation_sign`. The rest are
the ~47 mappings that were seeded without a sign hint — low-hanging
follow-up.

**Adversarial path caught 5 cases** (all of CENT's non-clean except
sign_flip, plus ENEL's magnitude_1000x and row_swap). That's the
rule-based constraint mechanism working as designed on CENT, plus the
LLM critic earning its keep on ENEL.

### CENT sign_flip is the remaining miss

CENT's `Net revenue` mapping has `validation_sign = null` (not seeded
when the mapping was created), so the basic sign check can't fire. The
rule-based gross_profit constraint can't fire either — `flow: "inflow"`
uses `+|value|`, which absorbs the flip. So CENT sign_flip falls through
to the LLM critic, which returns "pass" because the debate team doesn't
see an obvious arithmetic breakage.

**Fix:** one-row DB update to populate `validation_sign='positive'` on
the CENT Net revenue mapping (and any other commonly-critical row
without a sign hint). Not shipped in this commit because it's analyst
data work, not code, and `validation_sign` assignment for each line is
an analyst-level decision.

### ENEL target changed from "constrained" to "uncovered"

With the bare `"Ingresos"` alternative removed from the revenue pattern,
ENEL's `Ingresos financieros` no longer prefix-matches any constraint
term. The picker now falls through to first-non-zero, lands on the same
row (it's the first mapping by ID), and the target field says "uncovered".
Interestingly, ENEL's catch rate went **up** from 33% to 50% because
the basic validator's sign check compensates — the picker's classification
is more honest without the coverage changing.

### What's still missing

Three corruptions are still hard for the current validator:

- **decimal_shift (25%)** — small magnitude shifts (÷10) rarely break
  constraint arithmetic above the 1% tolerance floor unless the victim
  is a large input. Only CENT catches it, via the gross_profit
  violation.
- **magnitude_1000x (50%)** — caught when the victim is a constraint
  input large enough to break arithmetic. CENT catches it via constraint;
  ENEL catches it via LLM. BANREGIO and NTCO3 miss because no constraint
  fires.
- **zero_wipe (25%)** — only CENT catches. A zero value is a legitimate
  state for many rows, so the basic validator doesn't flag it, and
  constraint arithmetic tolerates it unless the zero is a significant
  term.

The honest ceiling without expanding constraint coverage is around 60%
aggregate catch rate. To go higher, add industry-specific constraint
sets (banking, retail, utilities) so BANREGIO / NTCO3 / ENEL each have
a rule-based layer that fires. That's the task W3 could address, but
it's constraint dictionary expansion rather than adversarial fidelity —
still not W3.1.

### Verdict (updated)

- **W3.1 still deprioritized.** The critic fidelity upgrade would raise
  the ~50% adversarial-path ceiling on ENEL-like runs but wouldn't help
  BANREGIO or NTCO3 where `shouldTriggerAdversarial` returns false on
  clean high-confidence runs.
- **Next highest leverage:** populate `validation_sign` on the ~47
  missing mappings. Almost free (analyst data work), closes most of
  the remaining sign flip gap.
- **Second highest leverage:** industry-specific constraint sets. Not
  in scope for the current eval series.

### Second raw eval output

Full per-case table lives in `/tmp/eval-output-v2.md` from the run at
`2026-04-14T10:~` (appended to this doc). Corpus: CENT run 29, BANREGIO
run 16, NTCO3 run 50 (fresh), ENELCHILE run 12. 24 cases, 160s wall
time, 39 judge votes.

---

## Third run — after CENT Net revenue `validation_sign` populated

The second baseline called out CENT Net revenue as the one mapping in
the eval corpus that still had `validation_sign = NULL`, which is why
CENT sign_flip fell through the basic validator and then couldn't
trigger the flow-based gross_profit constraint (`+|value|` absorbs the
sign). One-row fix: `UPDATE field_mappings SET validation_sign =
'positive' WHERE company_id = 2 AND source_label = 'Net revenue'`
(mapping id 129). Script: `scripts/fix-cent-net-revenue-sign.ts`.

### Headline numbers

| metric | post-W1.7 | first 04-14 | second 04-14 | **third 04-14** |
|---|---|---|---|---|
| False positive rate | 0% | 0% | 0% | **0%** |
| Error rate | 0% | 0% | 0% | **0%** |
| Sign flip catch rate | 25% | 0% | 75% | **100%** |
| Decimal shift catch rate | 0% | 25% | 25% | **50%** |
| Row swap catch rate | 50% | 50% | 75% | **75%** |
| Magnitude ×1000 catch rate | 0% | 50% | 50% | **50%** |
| Zero wipe catch rate | 0% | 25% | 25% | **50%** |

Aggregate non-clean catch rate: **65%** (up from 50% → 30% → 25%
post-W1.7). Still 0% false positives. CENT is now at 5/5 = 100% on
non-clean corruptions.

### What the one-row change unlocked

`[29/sign_flip]... caught basic=fail adv=pass` — the basic validator
now fires on the CENT sign flip because `Net revenue` has
`validation_sign='positive'`. The adversarial path still says "pass"
(expected — flow-based `+|value|` absorbs the sign), but the composite
`caught` flag is `fail OR needs_review`, so the case counts.

The surprise: **ENEL's decimal_shift and zero_wipe also started
catching** on this run, even though we didn't touch ENEL mappings.
Both now fire via the LLM critic returning `needs_review`, where the
previous run had them as `pass`. That's non-determinism in the critic,
not a model improvement. ENEL is now 5/5 like CENT.

- CENT: 5/5 ✅ (100%, was 4/5 before sign fix, was 4/5 in first run)
- ENEL: 5/5 ✅ (100%, was 2/5 before sign fix, was 2/5 in first run)
- BANREGIO: 2/5 (sign_flip via basic, row_swap via basic)
- NTCO3: 1/5 (sign_flip via basic only)

BANREGIO and NTCO3 are still hard-capped by the missing rule-based
layer. Their `shouldTriggerAdversarial` returns false on every case
(no violations, no warnings, confidence ≥ 0.85), so the LLM critic
never runs. Only the basic validator can catch them, and it only
catches sign flips plus the one sign-producing row swap on BANREGIO.

### CENT clean basic=warning

Noticed but not chased: CENT clean emits `basic=warning` because the
Gross revenue and Net revenue mappings both have `confidence_score =
0.5` (the basic validator's "Medium confidence" warning threshold is
<0.8, low is <0.5). This is a UI noise issue — not a false positive
in the eval (`caught` stays false for warning status), but Camila
sees a yellow banner on clean CENT runs in the review UI. Follow-up:
re-verify CENT concept mappings and bump confidence when an analyst
confirms them. Not urgent, not in scope.

### Where we are

Every corruption that's structurally catchable by the current stack
(sign check, constraint arithmetic, LLM critic floor) is now being
caught on runs that have the right ingredients:

- CENT has populated `validation_sign` + constraint coverage → 100%
- ENEL has `shouldTriggerAdversarial=true` via low-confidence mappings
  → 100% via LLM critic floor (non-deterministic, sits around 33-100%)
- BANREGIO gets sign_flip + sign-producing swap via `validation_sign`
  → 40%
- NTCO3 gets only sign_flip via `validation_sign` → 20%

The 65% aggregate is the honest ceiling without doing one of these:

1. **Industry-specific constraint dictionaries** (W3.x candidate).
   Banking constraints for BANREGIO, services/manufacturing for NTCO3.
   Would turn these two from "basic-only" catchers into full
   constraint+LLM-critic catchers. Biggest leverage, biggest scope.
2. **Populate `validation_sign` on the remaining ~47 null mappings.**
   Analyst data work. Helps sign_flip (already 100% in the eval
   corpus, but could cover more rows per run). Near-free.
3. **Force `shouldTriggerAdversarial=true` on clean high-confidence
   runs** so the LLM critic runs universally. Would eat ~4× more
   Haiku rounds per run and only helps at the ~33% LLM-floor rate.
   Not worth it.

### Verdict (third time)

- **W3.1 still deprioritized.** LLM critic fidelity isn't the bottleneck.
- **Next step, smallest:** investigate the CENT clean `basic=warning` —
  cosmetic UI fix, bumps Camila's review UX quality, one mapping
  confidence update.
- **Next step, biggest:** scope an industry-specific constraint set,
  starting with banking (BANREGIO is the acute case in the current
  corpus). Would move aggregate from 65% toward ~85%.

### Third raw eval output

Full per-case table lives in `/tmp/eval-output-v3.md`. Corpus: CENT
run 29, BANREGIO run 16, NTCO3 run 51 (fresh), ENELCHILE run 12.
24 cases, 125s wall time, 36 judge votes.
