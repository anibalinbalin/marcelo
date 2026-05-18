/**
 * Tests for mapping suggestion using autoreason-style debate.
 */
import { describe, it, expect } from "vitest";
import { candidatesToMappings, type MappingCandidate } from "../suggest-mappings";

describe("candidatesToMappings", () => {
  it("converts candidates to mapping records", () => {
    const candidates: MappingCandidate[] = [
      {
        target: { sheet: "PROJ", row: 5, label: "Revenue", expectedSign: "positive" },
        sourceLabel: "Ingresos",
        sourceSection: "[310000]",
        valueTransform: "divide_1000000",
        confidence: 0.95,
        proposedBy: "AB",
        reasoning: "Both agents agree on label match",
      },
      {
        target: { sheet: "PROJ", row: 7, label: "Cost of Sales", expectedSign: "negative" },
        sourceLabel: "Costo de ventas",
        sourceSection: "[310000]",
        valueTransform: "negate_divide_1000000",
        confidence: 0.90,
        proposedBy: "A",
        reasoning: "Label similarity match",
      },
    ];

    const mappings = candidatesToMappings(candidates, 123, "4Q25");

    expect(mappings.length).toBe(2);

    // First mapping
    expect(mappings[0].companyId).toBe(123);
    expect(mappings[0].sourceLabel).toBe("Ingresos");
    expect(mappings[0].sourceSection).toBe("[310000]");
    expect(mappings[0].targetSheet).toBe("PROJ");
    expect(mappings[0].targetRow).toBe(5);
    expect(mappings[0].valueTransform).toBe("divide_1000000");
    expect(mappings[0].validationSign).toBe("positive");
    expect(mappings[0].baseQuarter).toBe("4Q25");

    // Second mapping
    expect(mappings[1].sourceLabel).toBe("Costo de ventas");
    expect(mappings[1].targetRow).toBe(7);
    expect(mappings[1].valueTransform).toBe("negate_divide_1000000");
    expect(mappings[1].validationSign).toBe("negative");
  });

  it("uses default base quarter", () => {
    const candidates: MappingCandidate[] = [
      {
        target: { sheet: "PROJ", row: 5, label: "Revenue", expectedSign: "positive" },
        sourceLabel: "Ingresos",
        sourceSection: "[310000]",
        valueTransform: null,
        confidence: 0.8,
        proposedBy: "B",
        reasoning: "Value pattern match",
      },
    ];

    const mappings = candidatesToMappings(candidates, 1);

    expect(mappings[0].baseQuarter).toBe("1Q25");
  });
});
