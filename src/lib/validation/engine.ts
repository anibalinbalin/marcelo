/**
 * Validation engine for extracted financial data.
 * Runs sign checks and confidence thresholds.
 * DuckDB-based totals-match validation deferred to v2.
 */

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

    // Zero value check (unusual for most financial fields)
    if (numValue === 0) {
      return {
        id: v.id,
        status: "warning" as const,
        message: `Zero value for "${v.sourceLabel}" — verify this is correct`,
      };
    }

    return { id: v.id, status: "pass" as const, message: null };
  });
}
