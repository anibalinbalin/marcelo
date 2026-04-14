# Adversarial validator eval — after W1.5 JSON robustness (2026-04-13 night)

Third run of `scripts/eval-validator-harness.ts`, immediately after the
W1.5 change (swap `generateText` + manual `JSON.parse` for
`generateText` + `Output.object({ schema })` per ai-sdk v6).

Comparing against:
- `docs/eval-baseline-2026-04-13.md` (initial, before any fixes)
- `docs/eval-baseline-2026-04-13-post-w1-6.md` (after W1.6 tolerance refactor)

## Headline numbers

| metric | initial | post-W1.6 | **post-W1.5** |
|---|---|---|---|
| **Error rate** | 12.5% | 4% | **0%** |
| False positive rate | 25% | 50% | 25% |
| Sign flip catch rate | 50% | 50% | 25% |
| Decimal shift catch rate | 50% | 0% | 50% |
| Row swap catch rate | 50% | 50% | 50% |
| Magnitude ×1000 catch rate | 25% | 25% | 50% |
| Zero wipe catch rate | 25% | 50% | 25% |

## The one clear win: zero errors

**0/24 errors** this run — down from 3/24 initial, 1/24 post-W1.6. This
is the primary goal of W1.5: `Output.object({ schema })` enforces JSON
shape at the SDK tool-use layer, so there is no prose-wrapped JSON or
code-fence edge case for a manual parser to trip on. The ai-sdk
guarantees a valid object on success or throws a catchable error on
failure; either way, `JSON.parse` is not in the loop.

## Everything else is LLM noise at N=4

Catch rates for individual corruption types swung around between runs.
Comparing W1.6 vs W1.5 runs:
- sign_flip: 50% → 25% (worse)
- decimal_shift: 0% → 50% (better — recovered from W1.6 dip)
- magnitude_1000x: 25% → 50% (better)
- zero_wipe: 50% → 25% (worse)

These are almost certainly inside the noise floor. Judges run at
temperature 0.3-0.5; with only 4 cases per cell, one flipped vote
shifts a rate from 50% to 25% or 75%.

**Aggregate catch rate (all non-clean corruptions, all runs):**
- initial: 9/20 = 45%
- post-W1.6: 7/20 = 35%
- post-W1.5: 8/20 = 40%

All three numbers are inside a ±10% band. The only robust delta is the
error rate.

## Interesting: ENELCHILE now converges to pass more often

ENELCHILE sign_flip and zero_wipe now return `pass` with 6 judge votes
(2 rounds of 3 judges each) instead of needs_review after 1 round. The
tournament converges to "A wins twice consecutive" when judges flip
between rounds — which is what the spec says should happen when the
critic's complaints are weak.

This is either:
- (a) The right behavior — ENELCHILE's `Ingresos financieros = 11.631`
  is a tiny value with relative noise; flipping the sign on an 11-unit
  value in a statement dominated by revenue lines in billions is hard
  for a critic to notice without arithmetic context.
- (b) A regression — the critic's reasoning quality dropped when we
  stopped manually instructing it with "Return JSON only: { schema }"
  in the prompt. Output.object hides the schema from the model prompt
  and the model may be ignoring signal it would have caught.

Either way, this isn't what W1.5 was meant to address. Flagging as
observation, not fixing here.

## Verdict for W1.5

- ✅ Zero parse errors — the primary goal
- ✅ 7/7 unit tests still pass
- ✅ ai-sdk v6 migration (out with `generateObject`, in with
  `generateText` + `Output.object`)
- 〜 Catch rate unchanged within LLM noise
- ❓ ENELCHILE convergence shift needs watching — re-baseline after
  W1.4 to see if the pattern persists

Shipping. Next: W1.4 (trigger gate rework — always run rule-based
constraints, only call LLM on violations).
