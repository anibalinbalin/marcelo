# Marcelo hardening plan — ~2 weeks, goal: solid product for Camila

**Date:** 2026-04-13
**Motivation:** Camila's review flow works but is built on stubs and latent bugs. The PR #1 learning tables are inert, adversarial validation has silent model mismatches and a broken constraint set, and we have no way to measure whether the validator actually catches extraction errors. Ship a solid foundation before putting more stress on it.
**Research sources:** NousResearch/autoreason (verified), rohitg00 LLM Wiki v2 (verified, forked from karpathy), karpathy LLM Wiki (verified, April 4 2026). Three parallel Claude subagents produced initial recommendations; three parallel codex consult runs adversarially challenged each report. Codex caught ~5 concrete bugs and one major strategic error that every subagent missed.

## What codex surfaced that changed the plan

### Concrete bugs (week 1, task 1)

| # | Bug | Location | Fix |
|---|---|---|---|
| 1 | `getConstraintsForStatement("cashflow")` returns `[]` | `src/lib/validation/constraints.ts:99-100` | Implement or document |
| 2 | Critic + judges use `claude-haiku-3` (stale model ID) | `src/lib/validation/adversarial.ts:171,225` | Bump to `claude-haiku-4-5` |
| 3 | `tallyBordaCount` is weighted plurality, not Borda — misnamed | `src/lib/validation/adversarial.ts:243` | Rename or fix |
| 4 | `approveValues` uses `console.error` — violates global evlog rule | `src/app/actions/runs.ts:117,139` | Replace with evlog |

### Strategic error: record ≠ promote

Original plan: "every analyst correction writes to all 4 tables in one transaction."

Codex corrected: that conflates **recording the event** with **promoting knowledge into semantic memory**. A single correction from Camila may be company-specific, section-specific, quarter-specific, a formatting artifact, or a false positive. Writing it directly into `concept_aliases.usage_count` pollutes shared memory. The right pattern: **record every event immediately, promote only with repeated evidence + contradiction checks**.

### Schema isn't actually ready

Codex also caught that PR #1's schema hints at tiers but isn't strong enough to model:
- supersession (`field_mappings.supersededBy` exists but isn't an FK, unclear target)
- alias reinforcement (`concept_aliases` has no confidence, usage count, last_seen_at, or unique constraint)
- full audit trail (`mapping_history` lacks runId, extractedValueId, explicit old/new values, supersededByHistoryId, confidence_delta)

A schema migration needs to land BEFORE the learning loop is wired.

### The biggest missing piece: eval

None of the 4 agents (3 research + 1 planner) noticed that we have **no eval harness** for the validator. No synthetic corruption injection, no precision/recall measurement, no false-positive tracking, no cost-per-true-catch. Every "improvement" to the adversarial pipeline is speculative without this. W1.3 builds it first, so W3.1 can be decided by data instead of vibes.

---

## Execution order

### Week 1 — make the ground true

**W1.1 Bug sweep** (half day) — fix the 4 bugs in the table above. Zero risk, zero new surface area, all things currently lying in comments or memory. One commit or four atomic commits — whichever is cleaner.

**W1.2 Review UI — surface explanations** (half day) — render `extracted_values.validationMessage` as a tooltip next to the warning badge in `src/app/companies/[id]/runs/[runId]/review-client.tsx` (currently ignored). Also persist `criticOutput.issues[]` on the run row even when `overallAssessment === "correct"` (`adversarial.ts:303-311` currently discards them) and surface as contextual hints. Zero new LLM cost. This is the thing that lets Camila stop guessing why rows are flagged.

**W1.3 Eval harness** (2 days) — `scripts/eval-harness.ts` takes known-good extractions (runs 16 REGIONAL, 21 NTCO3, 29 CENT, 12 ENELCHILE) and injects synthetic corruptions:
- row swaps (e.g., swap Current Assets row with Noncurrent Assets)
- sign flips (revenue shown negative)
- magnitude errors (×1000 thousand/million confusion)
- decimal shifts
- column mistakes (Dec-25 value placed in Dec-24 slot)
- OCR digit confusions (0↔O, 1↔l, 5↔S)
- subtotal leaks (a subtotal line emitted as a detail row)

Each corruption runs through the pipeline. Measurements:
- trigger rate (% of corrupted runs that fire `shouldTriggerAdversarial`)
- uplift rate (% of corrupted runs that get upgraded `warning → needs_review`)
- false positive rate (% of clean runs that get upgraded)
- per-error-class precision/recall
- cost per true catch

**Output:** table so we can tell whether W3.1 (adversarial fidelity upgrade) is worth doing.

### Week 2 — real learning loop

**W2.1 Schema migration** (1 day) — one drizzle migration covering:

1. Extend `mapping_history`:
   - `runId` (FK → extraction_runs)
   - `extractedValueId` (FK → extracted_values)
   - `oldValue`, `newValue` (explicit, not buried in `previousValues` JSONB)
   - `supersededByHistoryId` (self-FK)
   - `confidenceDelta` (numeric)

2. Extend `concept_aliases`:
   - `confidence` (numeric 0-1)
   - `usageCount` (int, default 0)
   - `lastSeenAt` (timestamp)
   - unique constraint on `(concept_id, alias_text, source_company_id)`

3. Fix `field_mappings.supersededBy`:
   - Make it a proper FK to `field_mappings.id`

4. Add new `learning_events` table per karpathy codex:
   ```
   id, event_type, entity_type, entity_id,
   mapping_id, concept_id, alias_id, run_id, company_id, extracted_value_id,
   source_label, previous_state JSONB, new_state JSONB,
   reason, trigger, actor_type, actor_id,
   model_name, prompt_version,
   created_at
   ```

   - `event_type`: `override_applied`, `mapping_relinked`, `alias_created`, `alias_matched`, `concept_assigned`, `confidence_updated`, `mapping_superseded`, `lint_flagged`
   - `entity_type`: `field_mapping`, `concept_alias`, `canonical_concept`, `extracted_value`
   - `actor_type`: `analyst`, `llm`, `system`
   - `trigger`: `analyst_override`, `auto_merge`, `lint`, `migration`, `backfill`

**W2.2 Record vs promote split** (1 day) — rewrite `approveValues` in `src/app/actions/runs.ts:78-93`:

- On every override: write a `learning_events` row + a `mapping_history` row with the full {old, new, run_id, extracted_value_id} context (recording).
- **Do NOT** touch `concept_aliases.usage_count` or `field_mappings.correction_count` (promoting).
- Idempotent via `UNIQUE (run_id, extracted_value_id, event_type)` on `learning_events`.
- evlog-wrapped per user's global logging rule.

**W2.3 Promotion pipeline** (1 day) — separate step (initially a one-shot script, potentially a cron later) that reads recent `learning_events` where `event_type = "override_applied"` and:

1. Groups by `(source_label, canonical_concept)`.
2. Applies contradiction checks: same normalized phrase colliding across different concepts → flag and skip.
3. Promotes to `concept_aliases` only when the same correction has been seen ≥ N times across distinct runs (N=3 initial, tunable).
4. On promotion: `usage_count++`, `last_seen_at = now()`, reinforcement-weighted `confidence` update.
5. Writes a `learning_events` row with `event_type = "alias_matched"` or `alias_created`.

### Week 3 — conditional

**W3.1 Adversarial fidelity upgrade** (1-1.5 days) — ONLY if W1.3 eval shows the current validator misses real errors. Strip `suggestedValue` from `CriticOutput` (`adversarial.ts:54-63`); add a real `runAuthorB` that rewrites the full value table given A + critic complaints; add `runSynthesizer` that merges A and B per row; randomize judge presentation order in `runJudgePanel`. If eval says current is already at acceptable noise, skip.

**W3.2 Lint pass** (half day) — daily cron over learning tables:
- orphan aliases (no linked mapping)
- mappings unverified > 30 days
- near-duplicate aliases (same normalized text, different concepts)
- mappings with repeated overrides but unchanged confidence → flag for manual review

---

## Deferred indefinitely

- **Cheap single-judge pre-gate.** Autoreason codex flagged it as internally inconsistent with the 3-judge argument. Revisit only if cost becomes material.
- **Hybrid BM25+vector+graph search on aliases.** Right threshold is ~500-1000 aliases, not our current 120. Revisit after onboarding ships.
- **Vector embedding of alias strings for onboarding candidate generation.** Useful for Phase 6 onboarding suggester (already untracked in `src/lib/onboarding/`), but not required for Camila's current flow. Revisit when onboarding gets its own turn.
- **Full three-layer LLM Wiki architecture.** Right spirit, wrong medium. Mine the patterns (middle layer, lint, event log); skip the Obsidian.

---

## Non-goals

- No API shape changes for the review UI. Camila sees the same screen, just with real explanations.
- No behavior change to writeback. Already verified clean in earlier E2E.
- No new extraction paths. Everything in this plan is pipeline hygiene + feedback loop infra.
- No `src/app/api/onboarding/` or `src/lib/onboarding/` work (Phase 2 autoreason, still untracked). Separate concern.

---

## Decision log

- **2026-04-13 pm:** Anibal chose ~2 weeks of focused work over shipping bug sweep as a standalone PR. Motivation: "I prefer to have a solid product for them."
- **2026-04-13 pm:** 3 research subagents + 3 codex challenges completed before the plan was finalized. Codex corrected several subagent claims — see "What codex surfaced" above.

---

## Related

- Spec: `docs/superpowers/specs/2026-04-13-extraction-memory-design.md`
- Shipped foundation: `docs/superpowers/plans/2026-04-13-extraction-memory-foundation.md`
- Commits: `3e551d3` (PR #1 extraction memory), `5820f02` (autoreason phase 1 adversarial validation)
- Memory refs: `project_extraction_memory_phase12_shipped.md`, `project_autoreason_integration.md`
