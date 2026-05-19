import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEEPSEEK_JUDGE_FAILED,
  DEEPSEEK_JUDGE_NEEDS_REVIEW,
  runDeepSeekSourceJudge,
  type SourceJudgeValue,
} from "../source-judge";
import {
  isHardApprovalBlock,
  isSoftApprovalBlock,
  validateApprovalOverride,
} from "../source-guards";

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelName: string) => ({ modelName }),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
  Output: {
    object: (config: unknown) => config,
  },
}));

function bimboValue(
  id: number,
  sourceLabel: string,
  extractedValue: number,
): SourceJudgeValue {
  return {
    id,
    sourceLabel,
    sourceSection: "press_release",
    extractedValue: extractedValue.toFixed(6),
    targetSheet: "FAT",
    targetRow: 27,
  };
}

describe("runDeepSeekSourceJudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPSEEK_JUDGE_MODEL;
  });

  it("blocks fail-closed without an OpenRouter API key", async () => {
    const result = await runDeepSeekSourceJudge(
      1,
      [bimboValue(1, "Utilidad Bruta|México", 21952)],
      "Utilidad Bruta México 21952",
    );

    expect(result.status).toBe("error");
    expect(result.failures).toEqual([
      expect.objectContaining({
        valueId: 1,
        status: DEEPSEEK_JUDGE_FAILED,
      }),
    ]);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("blocks fail-closed for non-BIMBO source values too", async () => {
    const result = await runDeepSeekSourceJudge(
      2,
      [{
        id: 10,
        sourceLabel: "Ingresos",
        sourceSection: "[310000]",
        extractedValue: "123.000000",
        targetSheet: "PROJ",
        targetRow: 3,
        valueTransform: "divide_1000000",
      }],
      "SECTION [310000]\nIngresos: 123000000",
    );

    expect(result.status).toBe("error");
    expect(result.failures).toEqual([
      expect.objectContaining({
        valueId: 10,
        sourceLabel: "Ingresos",
        status: DEEPSEEK_JUDGE_FAILED,
      }),
    ]);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("turns a source-backed disagreement into a blocking value failure", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.DEEPSEEK_JUDGE_MODEL = "deepseek/deepseek-v4-pro";
    generateTextMock.mockResolvedValueOnce({
      output: {
        overallStatus: "block",
        summary: "Gross profit was copied from operating profit.",
        values: [
          {
            id: 6,
            sourceLabel: "Utilidad Bruta|México",
            verdict: "block",
            reason: "The evidence lists Utilidad Bruta México as 21952, not 6044",
            sourceValue: "21952",
            suggestedValue: "21952",
          },
        ],
      },
    });

    const result = await runDeepSeekSourceJudge(
      1,
      [bimboValue(6, "Utilidad Bruta|México", 6044)],
      "Utilidad Bruta México 21952\nUtilidad de Operación México 6044",
    );

    expect(result.status).toBe("block");
    expect(result.failures).toEqual([
      expect.objectContaining({
        valueId: 6,
        sourceLabel: "Utilidad Bruta|México",
        status: DEEPSEEK_JUDGE_FAILED,
        suggestedValue: "21952",
      }),
    ]);
  });

  it("marks insufficient evidence as a row-level review failure", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    const result = await runDeepSeekSourceJudge(
      1,
      [bimboValue(7, "Utilidad Bruta|EAA", 4390)],
      "",
    );

    expect(result.status).toBe("needs_review");
    expect(result.failures).toEqual([
      expect.objectContaining({
        valueId: 7,
        sourceLabel: "Utilidad Bruta|EAA",
        status: DEEPSEEK_JUDGE_NEEDS_REVIEW,
      }),
    ]);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("does not block on an incoherent model block that says values match", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce({
      output: {
        overallStatus: "block",
        summary: "Incorrect block from model.",
        values: [
          {
            id: 6,
            sourceLabel: "Utilidad Bruta|México",
            verdict: "block",
            reason: "Extracted value 21952.000000 matches PDF table value 21,952",
            sourceValue: "21,952",
          },
        ],
      },
    });

    const result = await runDeepSeekSourceJudge(
      1,
      [bimboValue(6, "Utilidad Bruta|México", 21952)],
      "Utilidad Bruta México 21952",
    );

    expect(result.status).toBe("pass");
    expect(result.failures).toEqual([]);
  });

  it("does not block when the transformed source value matches the extraction", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce({
      output: {
        overallStatus: "block",
        summary: "Incorrect sign objection from model.",
        values: [
          {
            id: 31,
            sourceLabel: "Impuestos a la utilidad",
            verdict: "block",
            reason: "Source value transforms to the extracted value, but the sign looks surprising.",
            sourceValue: "1,643,848,000",
            suggestedValue: "1643.848000",
          },
        ],
      },
    });

    const result = await runDeepSeekSourceJudge(
      1,
      [{
        id: 31,
        sourceLabel: "Impuestos a la utilidad",
        sourceSection: "[310000]",
        extractedValue: "-1643.848000",
        targetSheet: "PROJ",
        targetRow: 31,
        valueTransform: "negate_divide_1000000",
      }],
      "Impuestos a la utilidad 1,643,848,000",
    );

    expect(result.status).toBe("pass");
    expect(result.failures).toEqual([]);
  });

  it("does not block when the reason text contains a transformable source value", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    generateTextMock.mockResolvedValueOnce({
      output: {
        overallStatus: "block",
        summary: "Incorrect sign objection from model.",
        values: [
          {
            id: 9,
            sourceLabel: "Estimación preventiva para riesgos crediticios",
            verdict: "block",
            reason: "The extracted value is -471.000000, but the source lists the value as 471.",
            suggestedValue: "471.000000",
          },
        ],
      },
    });

    const result = await runDeepSeekSourceJudge(
      6,
      [{
        id: 9,
        sourceLabel: "Estimación preventiva para riesgos crediticios",
        sourceSection: "vision:36",
        extractedValue: "-471.000000",
        targetSheet: "PROJ",
        targetRow: 9,
        valueTransform: "negate",
      }],
      "Estimación preventiva para riesgos crediticios 471",
    );

    expect(result.status).toBe("pass");
    expect(result.failures).toEqual([]);
  });

  it("blocks fail-closed when the judge call fails", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    generateTextMock.mockRejectedValueOnce(new Error("model unavailable"));

    const result = await runDeepSeekSourceJudge(
      1,
      [bimboValue(6, "Utilidad Bruta|México", 21952)],
      "Utilidad Bruta México 21952",
    );

    expect(result.status).toBe("error");
    expect(result.failures).toEqual([
      expect.objectContaining({
        valueId: 6,
        status: DEEPSEEK_JUDGE_FAILED,
      }),
    ]);
  });
});

describe("approval gate helpers", () => {
  it("keeps source guard and DeepSeek block verdicts hard-blocking", () => {
    expect(isHardApprovalBlock("source_guard_failed")).toBe(true);
    expect(isHardApprovalBlock("deepseek_judge_failed")).toBe(true);
    expect(isSoftApprovalBlock("deepseek_judge_failed")).toBe(false);
  });

  it("requires a non-empty reasoned correction for soft failures", () => {
    const currentValue = {
      extractedValue: "100.000000",
      validationStatus: "fail",
    };

    expect(validateApprovalOverride(currentValue, undefined)).toBe(
      "missing analyst correction",
    );
    expect(validateApprovalOverride(currentValue, { value: "", reason: "wrong_source_match" })).toBe(
      "correction is blank",
    );
    expect(validateApprovalOverride(currentValue, { value: "101", reason: undefined })).toBe(
      "correction reason is required",
    );
    expect(
      validateApprovalOverride(currentValue, {
        value: "100.000000",
        reason: "wrong_source_match",
      }),
    ).toBe("correction must change the flagged value");
  });

  it("accepts numeric reasoned corrections for soft failures", () => {
    expect(
      validateApprovalOverride(
        { extractedValue: "100.000000", validationStatus: "deepseek_judge_needs_review" },
        { value: "101.25", reason: "wrong_source_match" },
      ),
    ).toBeNull();
  });

  it("rejects non-numeric corrections when the extracted value is numeric", () => {
    expect(
      validateApprovalOverride(
        { extractedValue: "100.000000", validationStatus: "error" },
        { value: "not a number", reason: "wrong_source_match" },
      ),
    ).toBe("correction must be numeric");
  });
});
