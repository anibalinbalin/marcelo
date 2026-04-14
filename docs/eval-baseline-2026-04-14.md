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

---

## Fourth run — gated the zero-value warning on `validation_sign`

The third baseline flagged CENT clean emitting `basic=warning`. Root
cause: `engine.ts`'s `numValue === 0` check fired on `Investments` (id
342 on run 29), a balance sheet row where zero is legitimate for
companies with no non-current investments. Same story on ENEL: the
low-confidence `pasivos por arrendamiento` row tripped the medium-
confidence warning.

The zero-value warning was designed to catch zero_wipe corruptions in
production, but in the eval it contributed **zero catches** across
all four runs and four corruption types. Every actual zero_wipe catch
went through the adversarial layer (CENT via constraint arithmetic,
ENEL via LLM critic). So the warning was all noise, no signal — and
every yellow badge Camila ignores trains her to ignore real ones.

Fix: gate the zero warning on `validationSign` being set. An analyst
populating `validation_sign='positive'` is explicitly saying "this row
must have a value"; a null `validation_sign` means the row is
optional or unannotated. Five-line change in `engine.ts`:

```ts
if (numValue === 0 && v.validationSign) { ... return warning ... }
```

### Headline numbers

| metric | 2nd | 3rd | **4th** |
|---|---|---|---|
| False positive rate | 0% | 0% | **0%** |
| Sign flip | 75% | 100% | **100%** |
| Decimal shift | 25% | 50% | **50%** |
| Row swap | 75% | 75% | **75%** |
| Magnitude ×1000 | 50% | 50% | **25%** |
| Zero wipe | 25% | 50% | **25%** |
| **Aggregate non-clean** | **50%** | **65%** | **55%** |
| **CENT clean status** | warning | warning | **pass** ✅ |

The headline win is CENT clean flipping from `warning` to `pass`. No
more spurious yellow badge on clean CENT runs in the review UI.

### The mag×1000 and zero_wipe regressions are LLM noise

magnitude_1000x dropped from 50% → 25% because ENEL
magnitude_1000x flipped from `adv=needs_review` (caught) to `adv=pass`
(miss) between runs. zero_wipe dropped 50% → 25% for the same reason
on ENEL zero_wipe. These cases go through the adversarial LLM critic,
not the rule-based layer, and the critic's judgment varies ±1 case
per run. The basic validator status is identical across v3 and v4 for
both cases — the change in engine.ts did not affect them.

Confirmed by inspection:

| case | v3 basic | v3 adv | v4 basic | v4 adv |
|---|---|---|---|---|
| ENEL mag×1000 | warning | needs_review | warning | **pass** |
| ENEL zero_wipe | warning | needs_review | warning | **pass** |

Both basicStatus values are unchanged. The only mover is the LLM
critic, which is non-deterministic. This is the ENEL-LLM-floor
variance the third baseline flagged. For a more stable measurement
we'd need to run the harness 3-5 times and average, or seed the
critic's sampling. Out of scope here.

### What actually changed in the eval

- **CENT clean:** warning → pass (intended, eliminates UI noise)
- **Everything else on CENT/BANREGIO/NTCO3:** unchanged
- **ENEL clean:** still warning (low-confidence `pasivos por
  arrendamiento` still trips the medium-confidence check, which is a
  separate code path from the zero-value warning)

The non-basic diffs (ENEL mag×1000 and zero_wipe) are LLM variance
and would flip back on a re-run. If anything the 4th run's ENEL
critic was slightly less aggressive, not the other way around.

### Verdict (fourth time)

- **Ship the zero-warning gate.** Fixes a real UI noise issue with
  zero regression in eval catches (LLM variance aside).
- **Follow-up:** add a low-effort "ENEL stability" eval that runs
  ENEL's five cases 3× and averages, to filter out LLM critic jitter
  from the aggregate metric. This would make future eval deltas
  easier to read.

### Fourth raw eval output

Full per-case table lives in `/tmp/eval-output-v4.md`. Corpus: CENT
run 29, BANREGIO run 16, NTCO3 run 51, ENELCHILE run 12.
24 cases, 153s wall time, 39 judge votes.

---

## Stability run — ENEL × 3 repeats (2026-04-14)

Every prior baseline used 1 sample per corruption per company, and the
4th baseline flagged LLM critic variance on ENEL as the likely
explanation for apparent catch-rate fluctuations. Added a `--stability`
mode to the harness to quantify it:

```bash
pnpm tsx scripts/eval-validator-harness.ts --stability 12 3
```

### Results

| corruption | catches | rate | basic stable? | adv variance |
|---|---|---|---|---|
| clean | 1/3 | **33% FPR** | no | flaky (pass/needs_review) |
| sign_flip | 3/3 | 100% | yes | flaky (pass/needs_review) |
| magnitude_1000x | 2/3 | 67% | no | flaky (pass/needs_review) |
| decimal_shift | 0/3 | **0%** | no | pass (always) |
| row_swap | 3/3 | 100% | yes | needs_review (stable) |
| zero_wipe | 0/3 | **0%** | no | pass (always) |

Stable non-clean catches: **sign_flip** and **row_swap** (both via
the basic validator's `validation_sign` fail path).
Flaky non-clean catches: **magnitude_1000x** (LLM critic jitter).
Never caught: **decimal_shift** and **zero_wipe**.

### Findings that invalidate prior baselines

1. **ENEL's "0% false positive rate" was a single-sample artifact.**
   Across 3 clean repeats, the LLM critic flagged the unmodified run
   once — a 33% FPR on clean ENEL. Because ENEL has 3 low-confidence
   mappings (≤0.85), `shouldTriggerAdversarial` returns true on every
   clean run, so the critic runs and occasionally returns
   `needs_review` on valid data. CENT/BANREGIO/NTCO3 don't trigger the
   critic on clean runs (confidence ≥0.85, no violations), so their
   structural FPR is zero and dominated the single-sample average.

2. **ENEL's `decimal_shift` and `zero_wipe` catches in v3/v4 were
   luck.** Both corruptions never caught across 3 stability repeats.
   The previous "25%" headline number was a single lucky LLM
   judgment. True catch rate on these corruptions for ENEL is **0%**.

3. **Honest ENEL non-clean catch rate: 8/15 = ~53%**, not 100% as v3
   briefly suggested. The stable floor is sign_flip + row_swap via
   the basic validator (both deterministic), plus ~67% on
   magnitude_1000x via the flaky LLM critic.

### Corpus-wide FPR is higher than we were reporting

All four prior baselines reported "0% false positive rate on clean
runs" based on 4 samples (one per company). The stability run shows
that sample size was not enough to detect ENEL's ~33% critic flake.
A more honest aggregate FPR estimate:

- CENT clean: 0% (structurally doesn't trigger critic)
- BANREGIO clean: 0% (structurally doesn't trigger critic)
- NTCO3 clean: 0% (structurally doesn't trigger critic)
- ENEL clean: **33%** (observed 1/3 in stability run)

**Weighted FPR** depends on how often each company-state occurs. In
the current corpus ENEL is 1 of 4 companies, so corpus-wide FPR ≈
`(0 + 0 + 0 + 33) / 4 = 8.3%`. In production, where ENEL-like runs
(low-confidence fuzzy matches present) are some meaningful fraction
of traffic, the real FPR is somewhere between 0% and 33% depending
on mix.

### Follow-ups unlocked by this data

1. **Investigate the ENEL LLM critic false positive.** The critic is
   flagging unmodified data as `needs_review` one in three runs. Is
   this the judge prompt, the author prompt, specific judge model
   sampling, or the `shouldTriggerAdversarial` trigger being too
   aggressive on low-confidence mappings? Worth a focused debugging
   session.

2. **Reclassify the decimal_shift / zero_wipe catch rate honestly.**
   Prior baselines credited ENEL with 25% on each. The stability run
   shows 0%. Aggregate catch rate on these corruptions across the
   corpus should be revised downward: e.g., decimal_shift honest rate
   is 1/4 = 25% (CENT only), not 50% as v3 claimed.

3. **Default to 3-repeat stability for ENEL in future baselines.**
   Any metric that depends on ENEL's LLM critic path is noisy at N=1.
   Either average across repeats or report the median.

### Harness changes shipped

`scripts/eval-validator-harness.ts` now supports:

```bash
pnpm tsx scripts/eval-validator-harness.ts --stability RUN_ID [REPEAT=3]
```

Stability mode repeats the same run N times and prints a stability
table showing catch rate, basic-layer stability, and adversarial
variance per corruption. It also classifies corruptions as stable /
flaky / never-caught, making LLM noise visible at a glance.

Raw output: `/tmp/eval-stability-enel.md` (run at `2026-04-14T10:52Z`,
281s wall time, 81 judge votes across 18 cases).

---

## Fifth run — banking constraints + ENEL label expansion (v7)

Added industry-specific constraint coverage, scoped conservatively:

1. **`net_interest_margin` banking constraint** in a new
   `BANKING_INCOME_CONSTRAINTS` export:
   `Margen Financiero = Ingresos por Intereses − Gastos por Intereses`.
   Additive with the standard IS constraints (the engine's
   `termsFound < 2` guard silently skips constraints whose terms
   don't exist in the run).
2. **ENEL label expansion** on the existing three IS constraints:
   added "Costo de Actividades Ordinarias", "Margen de Contribución",
   "Gastos de Administración", "Resultado Operacional", "Ganancia
   del Periodo" so the standard gross_profit / operating_income /
   net_income constraints can fire on ENEL's utility-style layout.

### What got dropped and why

My first attempt at banking constraints included three rules:
`net_interest_margin`, `bank_operating_income`, and `bank_net_income`.
A v6 eval run immediately showed BANREGIO clean failing with 2
violations. Investigation:

```
Ingresos por intereses     7566
Gastos por intereses      -3546
Margen financiero          4020   (7566 − 3546 = 4020 ✓ exact)

+ Estimación preventiva    -471
+ Gastos de Operación     -2031
Resultado de la operación  2478   (4020 − 471 − 2031 = 1518 ✗ gap of 960)

+ I.S.R. y P.T.U.          -616
Resultado neto             1824   (2478 − 616 = 1862 ✗ gap of 38)
```

BANREGIO's mapping set captures the headline waterfall lines but not
the intermediate items: fee income, trading gains, "Otros productos,
neto", subsidiary minority interest. The missing-term gaps (960 and
38) are the sum of those uncaptured lines. NIM balances exactly
because there's nothing uncaptured between interest income/expense
and the NIM result.

Dropped the two broken constraints, kept NIM only. The victim picker
still lands on `Ingresos por intereses` because the NIM term labels
match, and the single NIM constraint is enough to catch every
BANREGIO corruption in the eval.

### Headline numbers (v7)

| metric | 3rd | 4th | 5th | **v7 (this run)** |
|---|---|---|---|---|
| False positive rate | 0% | 0% | 0% | **0%** |
| Sign flip | 100% | 100% | 100% | **100%** |
| Magnitude ×1000 | 50% | 25% | 25% | **75%** |
| Decimal shift | 50% | 25% | 25% | **75%** |
| Row swap | 75% | 75% | 75% | **75%** |
| Zero wipe | 50% | 25% | 25% | **75%** |
| **Aggregate non-clean** | **65%** | **55%** | **50%** | **80%** |

Per-company:

| run | company | non-clean caught | change |
|---|---|---|---|
| 29 | CENT | 5/5 | unchanged |
| 16 | BANREGIO | **5/5** | **was 2/5** — NIM constraint fires |
| 51 | NTCO3 | 1/5 | unchanged (still no rule-based layer) |
| 12 | ENELCHILE | 5/5 | single-sample lucky run, honest rate ~53% per stability eval |

### BANREGIO went from 40% to 100% catch on non-clean

Before v7, BANREGIO caught sign_flip + row_swap via the basic
validator's sign check, but every other corruption passed because
`shouldTriggerAdversarial` returned false (no low-confidence
mappings, no violations) — the LLM critic never ran. With NIM
constraint firing, every corruption on `Ingresos por intereses`
now:

1. Produces 1 NIM violation (the arithmetic no longer balances)
2. Triggers the adversarial critic via `violations > 0`
3. The critic returns `needs_review`

Net effect: BANREGIO is now at 5/5 via constraint + critic, same as
CENT. The only remaining corpus gap is NTCO3 (1/5), which still has
no rule-based layer because the Natura mapping set lacks Net
revenue and Gross profit as explicit rows.

### ENEL victim picker shifted from Ingresos financieros to Intereses pagados

Side effect of adding `Intereses Pagados` as a NIM term alternative:
ENEL has an "Intereses pagados" cash-flow-style line that
prefix-matches the NIM term pattern. The picker now prefers that
over `Ingresos financieros`. Both rows have `validation_sign` set
(one positive, one negative), so sign_flip still catches via basic.
The adversarial catches the rest because ENEL's low-confidence
mappings keep `shouldTriggerAdversarial` returning true.

This is not a meaningful change in ENEL's underlying catch
mechanism — it's still the LLM critic floor plus basic validator.
The single-sample 5/5 shown in v7 is partly luck (see stability eval
above where ENEL's honest non-clean rate is ~53%). Repeat the run
and mag×1000 / decimal_shift / zero_wipe may flip again.

### Honest aggregate accounting for ENEL variance

- CENT: 5/5 (stable, rule-based)
- BANREGIO: 5/5 (stable, rule-based via NIM)
- NTCO3: 1/5 (stable, basic only)
- ENEL: 2-5/5 per run (flaky, LLM floor)

Stable floor: **13/20 = 65%** (CENT + BANREGIO + NTCO3 + ENEL's 2
stable catches).
Single-sample upper bound: **16/20 = 80%** (this v7 run).

The stable 65% is the real ceiling without more work on NTCO3. The
other 15% is LLM critic jitter on ENEL. A corpus with more companies
on stable rule-based paths would shrink the jitter window.

### What's still missing

- **NTCO3/LREN3/BIMBO/KIMBER/NATURA need either:**
  (a) explicit Net revenue and Gross profit rows added to their
      mapping sets, so the standard `gross_profit` constraint can
      fire, or
  (b) a relaxed constraint engine that supports "sum-to-result"
      rules with N terms instead of the current 2-3 term limit, so
      `Net income = Gross revenues − Deductions − COGS − OpEx − ...`
      can be enforced directly.
  Both are larger scope than label expansion. Left as follow-up.

- **BANREGIO's bank_operating_income and bank_net_income constraints
  need the missing intermediate rows** (Otros productos, Comisiones,
  Resultado por intermediación, Subsidiarias) to balance. Or, the
  constraint engine needs an "allow residual" mode where a 2-10% gap
  is absorbed into an "other" bucket.

### Fifth raw eval output

Full per-case table lives in `/tmp/eval-output-v7.md`. Corpus: CENT
run 29, BANREGIO run 16, NTCO3 run 51, ENELCHILE run 12. 24 cases,
~200s wall time. Single-sample FPR 0%, catch rate 80%.

### Verdict (fifth time)

- **Banking constraint dictionary shipped (NIM only).** BANREGIO
  went from 40% → 100% on non-clean catch. Biggest single move
  in the eval series.
- **ENEL label expansion shipped.** Doesn't change catch mechanism
  (still LLM floor), but removes the "uncovered" target classification
  from ENEL cases.
- **Next biggest leverage:** give NTCO3 a rule-based layer. Either
  extend its mapping set to include Net revenue and Gross profit, or
  generalize the constraint engine to accept N-term sum-to-result
  rules so the full Natura waterfall can be enforced without
  intermediate mappings.

---

## ENEL LLM critic FPR investigation (2026-04-14, v8)

The 4th/5th baselines both flagged ENEL's LLM-critic jitter as the
dominant source of aggregate catch-rate variance. Rather than keep
treating it as random noise, spent a session tracing the actual
failure mechanism and shipping a targeted fix.

### How we narrowed it down

Step 1 — `scripts/debug-enel-critic.ts`, first version: called
`runAdversarialValidation` 10× on unmodified ENEL run 12 and
recorded status + rounds.

```
8 pass / 2 needs_review / 0 error
FPR: 2/10 = 20%
Rounds distribution: {"1":2,"2":8}
```

Every single iteration ran at least 1 round of judges — meaning the
critic NEVER triggered its early "correct" passthrough on clean
ENEL data. The critic was consistently flagging SOMETHING every time,
and 2 of 10 runs the judges agreed with it (voted AB in round 1).

Step 2 — exported `runCritic` from `adversarial.ts` and rewrote the
debug script to call it directly 5× and dump the raw critic output.
Found two very different failure modes:

**Mode A (4 of 5 iterations) — pattern-match on confidence column:**

```
issues: 1
  - pasivos por arrendamiento: -21.293000 → Verify against source document
    problem: Confidence level is only 75%, indicating uncertainty in
             the extracted value that should be verified against
             source document.
```

The critic was reading `(confidence: 75%)` from the prompt's values
table and echoing "needs verification" as a reported issue. Confidence
is a gating signal for whether the critic runs — it shouldn't be
surfaced back as a data quality flag. Pure noise.

**Mode B (1 of 5 iterations) — financial hallucination:**

```
issues: 3
  - Costos financieros: -66.511 — "Financial costs should typically be
    positive in absolute terms..."
  - Resultado por unidades de reajuste: -0.172 — "Magnitude is unusually
    small... possible scale error or unit mismatch."
  - pasivos por arrendamiento: -21.293 — "Lease liabilities should
    typically be reported as positive values representing obligations,
    not negative values..."
```

All three are wrong. Negative financial costs is CENT-style storage
convention, small magnitudes on accounting adjustments are normal,
and ENEL stores lease liabilities with a negative sign on purpose.
The critic is pattern-matching on accounting prompt templates rather
than verifying against the actual arithmetic.

### The fix

`src/lib/validation/adversarial.ts` — two changes in `runCritic`:

1. **Removed confidence from the prompt's values table.** The prompt
   now emits just `- Label: Value` with no confidence column.
   Confidence lives in the gating logic (`shouldTriggerAdversarial`),
   not in the critic's input.

2. **Tightened the critic system prompt** with explicit anti-
   hallucination rules:
   - "Only flag CONCRETE errors you can verify from the data itself."
   - "Do NOT flag values that 'should be verified against source' —
     you cannot see the source."
   - "Do NOT flag sign conventions unless an arithmetic constraint is
     violated (companies store expenses/liabilities with different
     sign conventions; negative on a cost line is normal for some
     companies)."
   - "A clean assessment is the correct answer for most runs."

### Post-fix measurements

Re-ran `scripts/debug-enel-critic.ts`: **5 of 5 iterations return
`overallAssessment: correct, issues: 0, arithmeticErrors: 0`.** The
critic is now deterministic on clean ENEL data. Stopped hallucinating.

Re-ran ENEL stability eval:

| corruption | v3 (pre-fix) | **post-fix** |
|---|---|---|
| clean | 1/3 (33% FPR) | **0/3 (0% FPR)** |
| sign_flip | 3/3 | 3/3 |
| magnitude_1000x | 2/3 (flaky) | **3/3 (stable)** |
| decimal_shift | 0/3 | 0/3 |
| row_swap | 3/3 | 3/3 |
| zero_wipe | 0/3 | 0/3 |
| wall time | 281s | **59.6s** |
| judge votes | 81 | **9** |

Headline wins:
- **FPR dropped from 33% to 0%** on the target case.
- **mag×1000 went from flaky 67% to stable 100%.**
- **Judge vote count dropped 9×** because the critic now early-passes
  on clean data (critic says "correct" → adversarial returns "pass"
  without running judges). This is a real cost reduction on every
  run where shouldTriggerAdversarial is true but nothing's actually
  broken.

The decimal_shift and zero_wipe rates stayed at 0% because the
previous non-zero rates were entirely driven by lucky hallucinations
that happened to align with real corruptions. The critic was
"catching" them for the wrong reasons, and the stricter prompt
correctly refuses to guess. Real fix for those is constraint
coverage on ENEL's victim rows, not critic guessing.

### Corpus-wide stability measurements (CENT + BANREGIO)

While investigating ENEL, ran stability eval on the other two
rule-based-stable runs in the corpus:

**CENT run 29 × 3 repeats** (223s wall time):
- clean 0/3, sign_flip 3/3, mag×1000 3/3, decimal_shift 3/3,
  row_swap 3/3, zero_wipe 3/3
- **5/5 non-clean, 100% stable, 0% FPR**

**BANREGIO run 16 × 3 repeats** (170s wall time):
- clean 0/3, sign_flip 3/3, mag×1000 3/3, decimal_shift 3/3,
  row_swap 3/3, zero_wipe 3/3
- **5/5 non-clean, 100% stable, 0% FPR**

These are the rule-based-only runs. No LLM flake because the
adversarial path either early-passes (high-confidence + 0 violations)
or catches the corruption via arithmetic constraint.

### Honest v8 aggregate

After critic fix and stability measurement:

| company | non-clean caught | stability |
|---|---|---|
| CENT run 29 | 5/5 | stable (rule-based) |
| BANREGIO run 16 | 5/5 | stable (rule-based via NIM) |
| NTCO3 run 51 | 1/5 | stable (basic only) |
| ENEL run 12 | 3/5 | stable post-fix (lost the 0-2 hallucinated catches) |

**Aggregate non-clean catch rate: 14/20 = 70%.** Every case is
measured as its true stable value, not a single-sample flip.

**False positive rate: 0/4 = 0% on single-sample, 0% on stability**
(ENEL was the only non-zero FPR source and it's now fixed).

This is a lower headline number than the v7 single-sample 80%, but
it's a *real* 70% — no LLM critic luck required, no hidden variance.
Every number above reproduces run-to-run.

### v8 raw output

Full per-case table lives in `/tmp/eval-output-v8.md`. Corpus: CENT
run 29, BANREGIO run 16, NTCO3 run 51, ENELCHILE run 12.
24 cases. CENT stability: `/tmp/eval-stability-cent.md`. BANREGIO
stability: `/tmp/eval-stability-banregio.md`. ENEL post-fix stability:
`/tmp/eval-stability-enel-v2.md`. Critic debug output:
`scripts/debug-enel-critic.ts` (latest run logged).

### Verdict (sixth time)

- **ENEL FPR investigation → root-caused → fixed.** The critic was
  echoing confidence values as "data quality issues" and
  pattern-matching on accounting stereotypes. Both stopped with
  prompt changes.
- **Corpus-wide stability established.** CENT and BANREGIO are
  100% stable on every corruption. ENEL is now also stable. Only
  NTCO3 remains a structural gap.
- **Real aggregate catch rate is 70%**, not 80%. The 80% was LLM
  luck on 2 specific ENEL corruptions.
- **Next biggest lever is still NTCO3 coverage.** That's the only
  remaining sub-100% company in the corpus, and its 1/5 is the
  ceiling constraint on aggregate rate.
