/**
 * Validation engine for extracted financial data.
 *
 * Two-phase validation:
 * 1. Basic validation: sign checks, confidence thresholds (fast, rule-based)
 * 2. Adversarial validation: autoreason-style debate for flagged extractions (LLM-based)
 */

// Re-export adversarial validation for pipeline integration
export {
  runAdversarialValidation,
  shouldTriggerAdversarial,
  checkArithmeticConstraints,
  type AdversarialResult,
  type ExtractedValueForValidation,
} from "./adversarial";

export interface ValidationInput {
  id: number;
  extractedValue: string;
  confidence: number;
  validationSign: string | null;
  sourceLabel: string;
}

export interface ValidationResult {
  id: number;
  status: "pass" | "warning" | "fail";
  message: string | null;
}

/**
 * Validate a set of extracted values against their mapping rules.
 */
export function runValidation(values: ValidationInput[]): ValidationResult[] {
  return values.map((v) => {
    const numValue = parseFloat(v.extractedValue);

    // Check if value is a valid number
    if (isNaN(numValue)) {
      return { id: v.id, status: "fail" as const, message: `Not a valid number: "${v.extractedValue}"` };
    }

    // Sign check
    if (v.validationSign === "positive" && numValue < 0) {
      return {
        id: v.id,
        status: "fail" as const,
        message: `Expected positive value for "${v.sourceLabel}", got ${numValue}`,
      };
    }
    if (v.validationSign === "negative" && numValue > 0) {
      return {
        id: v.id,
        status: "fail" as const,
        message: `Expected negative value for "${v.sourceLabel}", got ${numValue}`,
      };
    }

    // Confidence check
    if (v.confidence < 0.5) {
      return {
        id: v.id,
        status: "warning" as const,
        message: `Low confidence (${(v.confidence * 100).toFixed(0)}%) for "${v.sourceLabel}"`,
      };
    }
    if (v.confidence < 0.8) {
      return {
        id: v.id,
        status: "warning" as const,
        message: `Medium confidence (${(v.confidence * 100).toFixed(0)}%) for "${v.sourceLabel}"`,
      };
    }

    // Zero value check — only fire when the analyst has flagged the row as
    // "must have a value" via validationSign. Without that signal, zero is
    // legitimate for many balance sheet lines (Investments, Other receivables,
    // etc.), and the warning was training analysts to ignore yellow badges on
    // every clean run. See docs/eval-baseline-2026-04-14.md §3.
    if (numValue === 0 && v.validationSign) {
      return {
        id: v.id,
        status: "warning" as const,
        message: `Zero value for "${v.sourceLabel}" — verify this is correct`,
      };
    }

    return { id: v.id, status: "pass" as const, message: null };
  });
}
