import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";

export const DEEPSEEK_JUDGE_FAILED = "deepseek_judge_failed";
export const DEEPSEEK_JUDGE_NEEDS_REVIEW = "deepseek_judge_needs_review";

const DEFAULT_DEEPSEEK_MODEL = "deepseek/deepseek-v4-pro";
const JUDGE_PROMPT_VERSION = "source-judge-v2";
const MAX_SNIPPET_LINES = 140;
const REGION_ROW_RE = /^(Norteam[eé]rica|M[eé]xico|EAA|Latinoam[eé]rica|Grupo Bimbo)\s+[-(]?\d/i;
const TABLE_MARKERS = [
  "Ventas Netas",
  "Utilidad Bruta",
  "Utilidad de Operación",
  "Utilidad de Operacion",
  "UAFIDA Ajustada",
  "UAFIDA Aj",
];

const JudgeOutputSchema = z.object({
  overallStatus: z.enum(["pass", "block", "needs_review"]),
  summary: z.string(),
  values: z.array(
    z.object({
      id: z.number(),
      sourceLabel: z.string(),
      verdict: z.enum(["pass", "block", "needs_review"]),
      reason: z.string(),
      sourceValue: z.string().optional(),
      suggestedValue: z.string().optional(),
    }),
  ),
});

export interface SourceJudgeValue {
  id: number;
  sourceLabel: string;
  sourceSection: string | null;
  extractedValue: string | null;
  targetSheet?: string;
  targetRow?: number;
  valueTransform?: string | null;
}

export interface SourceJudgeFailure {
  valueId: number | null;
  sourceLabel: string;
  status: typeof DEEPSEEK_JUDGE_FAILED | typeof DEEPSEEK_JUDGE_NEEDS_REVIEW;
  message: string;
  suggestedValue: string | null;
}

export interface SourceJudgeResult {
  status: "pass" | "block" | "needs_review" | "skipped" | "error";
  message: string;
  failures: SourceJudgeFailure[];
  modelName: string;
  promptVersion: string;
}

interface JudgeOutput {
  overallStatus: "pass" | "block" | "needs_review";
  summary: string;
  values: {
    id: number;
    sourceLabel: string;
    verdict: "pass" | "block" | "needs_review";
    reason: string;
    sourceValue?: string;
    suggestedValue?: string;
  }[];
}

function getOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function findBimboSnippetByPage(pages: string[]): string {
  const primaryBlocks: string[] = [];
  const fallbackBlocks: string[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (pageIndex > 9) break;
    const lines = pages[pageIndex].split("\n").map(normalizeLine).filter(Boolean);
    const regionRows = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => REGION_ROW_RE.test(line));
    const tableTitles = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => TABLE_MARKERS.some((marker) => line.includes(marker)));

    if (regionRows.length < 3 && tableTitles.length === 0) continue;

    const selected = new Map<number, string>();
    for (const hit of [...regionRows, ...tableTitles]) {
      const start = Math.max(0, hit.index - 8);
      const end = Math.min(lines.length, hit.index + 10);
      for (let i = start; i < end; i++) selected.set(i, lines[i]);
    }

    if (selected.size > 0) {
      const block = `PDF page ${pageIndex + 1}\n${[...selected.values()].join("\n")}`;
      if (regionRows.length >= 3) primaryBlocks.push(block);
      else fallbackBlocks.push(block);
    }
  }

  const blocks = primaryBlocks.length > 0 ? primaryBlocks : fallbackBlocks;
  return blocks.join("\n\n").split("\n").slice(0, MAX_SNIPPET_LINES).join("\n");
}

export async function extractBimboJudgeEvidence(
  pdfBuffer: Buffer,
): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(pdfBuffer), { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
  return findBimboSnippetByPage(pages);
}

function valuesTable(values: SourceJudgeValue[]): string {
  return values
    .map((value) => {
      const target =
        value.targetSheet && value.targetRow
          ? ` -> ${value.targetSheet}!row ${value.targetRow}`
          : "";
      const source = value.sourceSection ? ` [source=${value.sourceSection}]` : "";
      const transform = value.valueTransform
        ? ` [transform=${value.valueTransform}]`
        : "";
      return `- id=${value.id} ${value.sourceLabel}${source}${target}${transform}: ${value.extractedValue ?? "null"}`;
    })
    .join("\n");
}

function buildJudgePrompt(
  companyId: number,
  values: SourceJudgeValue[],
  evidence: string,
): string {
  return `You are a source-grounded financial extraction judge for Camila's review workflow.

Task: compare the extracted company ${companyId} values against the source evidence below.

Rules:
- Use only the provided evidence. Do not use outside knowledge.
- Do not silently correct the extraction.
- If a value is clearly inconsistent with the evidence, verdict must be block.
- If evidence is insufficient or ambiguous for a value, verdict must be needs_review.
- Suggested values are advisory only; a human analyst must approve any correction.
- When a value lists a transform, apply that transform to the source evidence before comparing it to the extracted value.
- Pay special attention that "Utilidad Bruta" is not confused with "Utilidad de Operación".
- Each reviewed value must include the exact extracted id from the EXTRACTED VALUES list.

EXTRACTED VALUES:
${valuesTable(values)}

PDF EVIDENCE SNIPPETS:
${evidence || "(no relevant evidence extracted)"}

Return structured JSON with an overallStatus and one verdict per disputed or reviewed value.`;
}

function formatJudgeMessage(
  entry: JudgeOutput["values"][number],
  modelName: string,
): string {
  const source = entry.sourceValue ? ` Source value: ${entry.sourceValue}.` : "";
  const suggestion = entry.suggestedValue
    ? ` Suggested correction: ${entry.suggestedValue}.`
    : "";
  return `DeepSeek source judge (${modelName}): ${entry.reason}.${source}${suggestion}`;
}

function parseJudgeNumber(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/-?[\d,]+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function contradictsExtractedValue(
  entry: JudgeOutput["values"][number],
  extractedValue: string | null | undefined,
): boolean {
  const extracted = parseJudgeNumber(extractedValue ?? undefined);
  if (extracted === null) return false;

  const candidates = [
    parseJudgeNumber(entry.sourceValue),
    parseJudgeNumber(entry.suggestedValue),
  ].filter((candidate): candidate is number => candidate !== null);

  return candidates.some((candidate) => Math.abs(candidate - extracted) > 1e-6);
}

export async function runDeepSeekSourceJudge(
  companyId: number,
  values: SourceJudgeValue[],
  evidence: string,
): Promise<SourceJudgeResult> {
  const modelName = process.env.DEEPSEEK_JUDGE_MODEL ?? DEFAULT_DEEPSEEK_MODEL;
  const openrouter = getOpenRouter();
  const reviewValues = values.filter((value) => Boolean(value.sourceSection));

  if (reviewValues.length === 0) {
    return {
      status: "skipped",
      message: "DeepSeek source judge skipped for this company/source set",
      failures: [],
      modelName,
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }

  if (!openrouter) {
    return {
      status: "error",
      message: "DeepSeek source judge unavailable: OPENROUTER_API_KEY is not set",
      failures: reviewValues.map((value) => ({
        valueId: value.id,
        sourceLabel: value.sourceLabel,
        status: DEEPSEEK_JUDGE_FAILED,
        message:
          "DeepSeek source judge unavailable: OPENROUTER_API_KEY is not set. Approval is blocked fail-closed.",
        suggestedValue: null,
      })),
      modelName,
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }

  if (!evidence.trim()) {
    return {
      status: "needs_review",
      message: "DeepSeek source judge could not find source evidence",
      failures: reviewValues.map((value) => ({
        valueId: value.id,
        sourceLabel: value.sourceLabel,
        status: DEEPSEEK_JUDGE_NEEDS_REVIEW,
        message: "DeepSeek source judge could not find source evidence for this value.",
        suggestedValue: null,
      })),
      modelName,
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }

  try {
    const result = await generateText({
      model: openrouter(modelName),
      output: Output.object({ schema: JudgeOutputSchema }),
      messages: [{
        role: "user",
        content: buildJudgePrompt(companyId, reviewValues, evidence),
      }],
      temperature: 0,
    });
    const output = result.output as JudgeOutput;
    const valuesById = new Map(reviewValues.map((value) => [value.id, value]));
    const failures: SourceJudgeFailure[] = output.values
      .flatMap((entry): SourceJudgeFailure[] => {
        if (entry.verdict !== "block" && entry.verdict !== "needs_review") return [];
        const value = valuesById.get(entry.id);
        if (
          entry.verdict === "block" &&
          !contradictsExtractedValue(entry, value?.extractedValue)
        ) {
          return [];
        }
        const status: SourceJudgeFailure["status"] =
          entry.verdict === "block"
            ? DEEPSEEK_JUDGE_FAILED
            : DEEPSEEK_JUDGE_NEEDS_REVIEW;
        return [
          {
            valueId: value?.id ?? null,
            sourceLabel: value?.sourceLabel ?? entry.sourceLabel,
            status,
            message: formatJudgeMessage(entry, modelName),
            suggestedValue: entry.suggestedValue ?? null,
          },
        ];
      });

    return {
      status: failures.some((failure) => failure.status === DEEPSEEK_JUDGE_FAILED)
        ? "block"
        : failures.length > 0
          ? "needs_review"
          : "pass",
      message: output.summary,
      failures,
      modelName,
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  } catch (error) {
    const message = `DeepSeek source judge failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    return {
      status: "error",
      message,
      failures: reviewValues.map((value) => ({
        valueId: value.id,
        sourceLabel: value.sourceLabel,
        status: DEEPSEEK_JUDGE_FAILED,
        message: `${message}. Approval is blocked fail-closed.`,
        suggestedValue: null,
      })),
      modelName,
      promptVersion: JUDGE_PROMPT_VERSION,
    };
  }
}

export const runBimboDeepSeekJudge = runDeepSeekSourceJudge;
