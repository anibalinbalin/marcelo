/**
 * Tests for adversarial validation using autoreason-style debate.
 */
import { describe, it, expect } from "vitest";
import {
  checkArithmeticConstraints,
  shouldTriggerAdversarial,
  type ExtractedValueForValidation,
} from "../adversarial";

describe("checkArithmeticConstraints", () => {
  it("detects gross profit mismatch", () => {
    // Costs stored as positive (coefficient handles sign)
    const values: ExtractedValueForValidation[] = [
      { id: 1, sourceLabel: "Revenue", extractedValue: "1000", confidence: 1.0, validationStatus: "pass", validationMessage: null },
      { id: 2, sourceLabel: "Cost of Sales", extractedValue: "400", confidence: 1.0, validationStatus: "pass", validationMessage: null },
      { id: 3, sourceLabel: "Gross Profit", extractedValue: "500", confidence: 1.0, validationStatus: "pass", validationMessage: null }, // Should be 600
    ];

    const violations = checkArithmeticConstraints(values, "income");

    expect(violations.length).toBe(1);
    expect(violations[0].constraintName).toBe("gross_profit");
    expect(violations[0].expected).toBe(600); // 1000 - 400
    expect(violations[0].actual).toBe(500);
  });

  it("passes when constraints are satisfied", () => {
    // Costs stored as positive (coefficient handles sign)
    const values: ExtractedValueForValidation[] = [
      { id: 1, sourceLabel: "Revenue", extractedValue: "1000", confidence: 1.0, validationStatus: "pass", validationMessage: null },
      { id: 2, sourceLabel: "Cost of Sales", extractedValue: "400", confidence: 1.0, validationStatus: "pass", validationMessage: null },
      { id: 3, sourceLabel: "Gross Profit", extractedValue: "600", confidence: 1.0, validationStatus: "pass", validationMessage: null },
    ];

    const violations = checkArithmeticConstraints(values, "income");

    expect(violations.length).toBe(0);
  });

  it("handles Spanish labels", () => {
    // Costs stored as positive (coefficient handles sign)
    const values: ExtractedValueForValidation[] = [
      { id: 1, sourceLabel: "Ingresos Totales", extractedValue: "1000", confidence: 1.0, validationStatus: "pass", validationMessage: null },
      { id: 2, sourceLabel: "Costo de Ventas", extractedValue: "400", confidence: 1.0, validationStatus: "pass", validationMessage: null },
      { id: 3, sourceLabel: "Utilidad Bruta", extractedValue: "600", confidence: 1.0, validationStatus: "pass", validationMessage: null },
    ];

    const violations = checkArithmeticConstraints(values, "income");

    expect(violations.length).toBe(0);
  });
});

describe("shouldTriggerAdversarial", () => {
  it("triggers on warnings", () => {
    const values: ExtractedValueForValidation[] = [
      { id: 1, sourceLabel: "Revenue", extractedValue: "1000", confidence: 0.9, validationStatus: "pass", validationMessage: null },
      { id: 2, sourceLabel: "COGS", extractedValue: "400", confidence: 0.9, validationStatus: "warning", validationMessage: "Zero value" },
      { id: 3, sourceLabel: "Gross Profit", extractedValue: "600", confidence: 0.9, validationStatus: "pass", validationMessage: null },
    ];

    expect(shouldTriggerAdversarial(values)).toBe(true);
  });

  it("triggers on low confidence", () => {
    const values: ExtractedValueForValidation[] = [
      { id: 1, sourceLabel: "Revenue", extractedValue: "1000", confidence: 0.8, validationStatus: "pass", validationMessage: null },
      { id: 2, sourceLabel: "COGS", extractedValue: "400", confidence: 0.9, validationStatus: "pass", validationMessage: null },
      { id: 3, sourceLabel: "Gross Profit", extractedValue: "600", confidence: 0.9, validationStatus: "pass", validationMessage: null },
    ];

    expect(shouldTriggerAdversarial(values)).toBe(true);
  });

  it("does not trigger when all pass with high confidence", () => {
    const values: ExtractedValueForValidation[] = [
      { id: 1, sourceLabel: "Revenue", extractedValue: "1000", confidence: 0.95, validationStatus: "pass", validationMessage: null },
      { id: 2, sourceLabel: "COGS", extractedValue: "400", confidence: 0.95, validationStatus: "pass", validationMessage: null },
      { id: 3, sourceLabel: "Gross Profit", extractedValue: "600", confidence: 0.95, validationStatus: "pass", validationMessage: null },
    ];

    expect(shouldTriggerAdversarial(values)).toBe(false);
  });

  it("does not trigger with too few values", () => {
    const values: ExtractedValueForValidation[] = [
      { id: 1, sourceLabel: "Revenue", extractedValue: "1000", confidence: 0.5, validationStatus: "warning", validationMessage: "Low confidence" },
    ];

    expect(shouldTriggerAdversarial(values)).toBe(false);
  });
});
