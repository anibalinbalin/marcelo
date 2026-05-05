/**
 * Expectations describe what an analyst (Camila) would inspect after
 * approving a quarterly extraction. They encode three classes of truth:
 *
 *   1. fatAfterRecalc — cells in summary sheets whose final value only
 *      exists after Excel recalculates downstream formulas. Must be
 *      verified by opening the populated xlsx in real Excel.
 *
 *   2. projDuplicatePairs — pairs of mapping target cells that share a
 *      source label. They MUST hold different values, otherwise the
 *      duplicate-label collapse bug (Bug C, 2026-04-15) is back.
 *
 *   3. acceptedValidationWarnings — known/non-blocking validator warnings
 *      that should not fail the run.
 */
export interface CellExpectation {
  value: number;
  label: string;
  /** Absolute tolerance in source units (defaults to 0.5). */
  tolerance?: number;
}

export interface DuplicatePair {
  /** Sheet both mappings target. */
  sheet: string;
  /** First mapping target row (e.g. "r94"). */
  a: string;
  /** Second mapping target row (e.g. "r99"). */
  b: string;
  /** Human label for diff output. */
  label: string;
  /**
   * When true, both values equal to 0 passes. Use only when the
   * company legitimately has no data in both rows for this quarter
   * (e.g. LREN3 has no loans at all in 4Q25). Default false so
   * unexpected zero-collapse still fails loudly.
   */
  acceptZero?: boolean;
}

/**
 * A pre-approval extracted-value assertion. Keyed by "SHEET:rROW"
 * in Expectations.projPreApprovalCells, this pins the exact value
 * the extractor should have produced for a given mapping target.
 * Runs BEFORE approveValues, so contamination and duplicate-label
 * collapse die on the specific cells we know about.
 */
export type ExtractedCellExpectation = CellExpectation;

export interface Expectations {
  companyId: number;
  ticker: string;
  quarter: string;
  /** Absolute path to the source xlsx that Camila would upload. */
  sourceFile: string;
  /**
   * Pinned extracted values to verify BEFORE approval. Keyed by
   * "SHEET:rROW" (e.g. "PROJ:r109"). Any mapping whose extracted
   * value drifts past tolerance fails the run — the primary defense
   * against contamination-style bugs.
   */
  projPreApprovalCells: Record<string, ExtractedCellExpectation>;
  /** Cells in summary sheets to verify after Excel recalc. */
  fatAfterRecalc: Record<string, CellExpectation>;
  /** Sheet name for fatAfterRecalc cells. */
  fatSheet: string;
  /** Pairs of duplicate-label mappings that must hold different values. */
  projDuplicatePairs: DuplicatePair[];
  /** Validation warning patterns that are known/non-blocking. */
  acceptedValidationWarnings: RegExp[];
  /** Minimum number of mapped values expected from the run. */
  minExtractedValues: number;
}
