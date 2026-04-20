## Observations

- Camila reported three bad `FAT!CL` cells in the generated LREN3 workbook: rows `138`, `191`, and `240`. Her note says those cells are unexpectedly pulling from columns like `EU`/`EE`.
- Camila also reported six `PROJ!CL` total rows that should remain formulas but were pasted as literal values: `96`, `102`, `107`, `108`, `119`, and `128`.
- The repository's LREN3 template is [public/camila/LREN3 OK.xlsx](/Users/anibalin/Sites/2026/marcelo/public/camila/LREN3%20OK.xlsx), and the canonical LREN3 mappings live in [src/db/lren3-canonical.ts](/Users/anibalin/Sites/2026/marcelo/src/db/lren3-canonical.ts).
- `LREN3_PROJ_MAPPINGS` currently writes directly into `PROJ` rows `107`, `119`, and `128`, which matches half of Camila's "should be formulas" complaint.
- `writeBlueValues()` clones the previous column into the target column before applying literal writes, and it also demotes formula cells to literals when a mapping targets them. That means adjacent shared-formula groups may be affected even when the reported bad rows are not directly mapped.

## Hypotheses

### H1: Some LREN3 PROJ total rows were incorrectly added to the canonical mapping list (ROOT HYPOTHESIS)
- Supports: `PROJ` rows `107`, `119`, and `128` are explicit mappings in `LREN3_PROJ_MAPPINGS`, and Camila says they should remain formulas.
- Conflicts: Camila also reported bad formula behavior on `PROJ` rows `96`, `102`, and `108`, which are not currently mapped.
- Test: remove the suspect total-row mappings from the canonical list, add regression tests asserting those rows stay unmapped, and inspect whether the remaining reported bad rows still get corrupted in a synthetic writeback experiment.

### H2: The surgical writer is corrupting nearby shared formulas in `PROJ` and `FAT` when it clones/demotes target-column cells
- Supports: the bad `FAT` rows `138`, `191`, and `240` are not mapped, so a side effect in shared-formula promotion/demotion is a plausible mechanism.
- Conflicts: some bad `PROJ` rows are directly mapped totals, so not all failures require writer corruption.
- Test: run a minimal writeback against the local LREN3 template using dummy values only for mapped rows near the reported areas, then inspect the generated XML/formulas for `FAT!CL138`, `FAT!CL191`, `FAT!CL240`, `PROJ!CL96`, `PROJ!CL102`, `PROJ!CL107`, `PROJ!CL108`, `PROJ!CL119`, and `PROJ!CL128`.

### H3: The LREN3 literal/formula exception lists are incomplete for the newly-added operating-data and balance-sheet rows
- Supports: tests currently assert only `FAT` literal rows plus `FAT:53` as formula-only; there is no explicit protection for `PROJ` formula totals or for the newly-added operating-data neighborhoods around row `240`.
- Conflicts: incomplete tests do not themselves change workbook output; they only allow the wrong code to persist.
- Test: add regression coverage for the reported rows, then confirm the code fails before the fix and passes after.

## Experiments

### E1: Run the real LREN3 surgical writer against the local template with dummy writes for every canonical mapping
- Result: confirmed both reported failure modes.
- Evidence:
  - `PROJ!CL107`, `PROJ!CL119`, and `PROJ!CL128` were converted to literals because they were still in `LREN3_PROJ_MAPPINGS`.
  - `PROJ!CL96`, `PROJ!CL102`, and `PROJ!CL108` stayed as formulas.
  - `FAT!CL138`, `FAT!CL191`, and `FAT!CL240` were corrupted from their original formulas to shifted references using columns like `EU`, `EV`, `EE`, and `EA`.

### E2: Patch the canonical mappings and make `clonePreviousColumn()` skip cells that already exist in the target column
- Result: confirmed.
- Evidence:
  - Regression tests now assert `PROJ` rows `96`, `102`, `107`, `108`, `119`, and `128` remain unmapped.
  - A writer regression test now runs the real LREN3 template through `writeBlueValues()` and verifies the reported `FAT!CL...` and `PROJ!CL...` formula cells are byte-for-byte unchanged while mapped cells still become literals.
  - `npx vitest run src/db/__tests__/lren3-canonical.test.ts src/lib/excel/__tests__/surgical-writer.test.ts` passes.

## Root Cause

LREN3 had two independent regressions: three `PROJ` total rows that should have stayed template formulas were mistakenly present in the canonical mapping list, and the surgical writer always recloned the previous column into the target column even when that target column already existed in the template, overwriting valid `CL` formulas with shifted formulas derived from `CK`.

## Fix

- Removed `PROJ` mappings for rows `107`, `119`, and `128` from `LREN3_PROJ_MAPPINGS` and documented the protected `PROJ` formula rows.
- Updated `clonePreviousColumn()` to insert only missing target-column cells instead of replacing cells that already exist.
- Updated `generatePopulatedExcel()` to ignore inactive mappings, then deactivated the stale LREN3 DB rows for `PROJ:107`, `PROJ:119`, and `PROJ:128` before regenerating the published workbook.
- Added regression coverage for both the canonical mapping rules and the surgical writer behavior on the real LREN3 template.
