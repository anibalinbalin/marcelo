/**
 * Mapping suggestion using autoreason-style debate.
 *
 * For new company onboarding, generates candidate mappings from an unknown PDF
 * by running two agents with different strategies:
 *
 * Agent A: Label similarity — fuzzy matches source labels to known patterns
 * Agent B: Value patterns — infers mappings from numeric relationships
 *
 * A judge synthesizes both into ranked candidates per target cell.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { PdfSection } from "@/lib/pdf/extract";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TemplateCell {
  sheet: string;
  row: number;
  label: string;
  expectedSign: "positive" | "negative" | null;
  col?: number;
  colLetter?: string;
}

export interface MappingCandidate {
  /** Target cell in template */
  target: TemplateCell;
  /** Source label from PDF */
  sourceLabel: string;
  /** Source section (e.g., "[310000]" or "vision:33") */
  sourceSection: string;
  /** Suggested value transform */
  valueTransform: string | null;
  /** Exact source row when the source workbook supports stable row lookup */
  sourceRow?: number | null;
  /** Source period/header when the source workbook requires column lookup */
  sourceCol?: string | null;
  /** Target base column in the model template */
  targetColBase?: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Which agent proposed this (A=label, B=value, AB=synthesis) */
  proposedBy: "A" | "B" | "AB" | "XLSX";
  /** Reasoning for this mapping */
  reasoning: string;
  /** Analyst-facing reasons this candidate should not be accepted silently */
  reviewReasons?: string[];
  /** Compact audit evidence for the analyst-facing review */
  evidence?: {
    sourceValue?: number | null;
    targetValue?: number | null;
    transformedValue?: number | null;
    sourceAddress?: string;
    targetAddress?: string;
    transform?: string | null;
  };
}

export interface SuggestionResult {
  candidates: MappingCandidate[];
  /** Mappings grouped by target cell, ranked by confidence */
  byTarget: Map<string, MappingCandidate[]>;
  /** Total time taken in ms */
  durationMs: number;
}

// ── Known Template Structure ─────────────────────────────────────────────────

/**
 * Standard PROJ sheet structure used by LarrainVial.
 * Blue cells are the targets for extracted values.
 */
const PROJ_TEMPLATE_CELLS: TemplateCell[] = [
  // Income Statement
  { sheet: "PROJ", row: 5, label: "Revenue / Ingresos / Receita", expectedSign: "positive" },
  { sheet: "PROJ", row: 7, label: "Cost of Sales / Costo de Ventas / Custo", expectedSign: "negative" },
  { sheet: "PROJ", row: 9, label: "Gross Profit / Utilidad Bruta / Lucro Bruto", expectedSign: "positive" },
  { sheet: "PROJ", row: 11, label: "SG&A / Gastos de Venta / Despesas", expectedSign: "negative" },
  { sheet: "PROJ", row: 13, label: "Operating Income / EBIT / Utilidad de Operación", expectedSign: "positive" },
  { sheet: "PROJ", row: 15, label: "Interest Income / Ingresos Financieros", expectedSign: "positive" },
  { sheet: "PROJ", row: 16, label: "Interest Expense / Gastos Financieros", expectedSign: "negative" },
  { sheet: "PROJ", row: 30, label: "Pre-tax Income / Utilidad antes de Impuestos", expectedSign: null },
  { sheet: "PROJ", row: 31, label: "Income Tax / Impuestos", expectedSign: "negative" },
  { sheet: "PROJ", row: 35, label: "Net Income / Utilidad Neta / Lucro Líquido", expectedSign: null },

  // Balance Sheet
  { sheet: "PROJ", row: 42, label: "Cash / Efectivo / Caixa", expectedSign: "positive" },
  { sheet: "PROJ", row: 45, label: "Current Assets / Activo Circulante", expectedSign: "positive" },
  { sheet: "PROJ", row: 55, label: "Total Assets / Activo Total", expectedSign: "positive" },
  { sheet: "PROJ", row: 60, label: "Current Liabilities / Pasivo Circulante", expectedSign: "positive" },
  { sheet: "PROJ", row: 70, label: "Total Liabilities / Pasivo Total", expectedSign: "positive" },
  { sheet: "PROJ", row: 80, label: "Total Equity / Capital Contable / Patrimônio", expectedSign: "positive" },
];

// ── Configuration ────────────────────────────────────────────────────────────

function getOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
}

// ── Agent A: Label Similarity ────────────────────────────────────────────────

async function runAgentA(
  sections: PdfSection[],
  templateCells: TemplateCell[]
): Promise<MappingCandidate[]> {
  const openrouter = getOpenRouter();

  // Build source labels list
  const sourceLabels: { section: string; label: string; values: string }[] = [];
  for (const section of sections) {
    for (const table of section.tables) {
      for (const row of table.rows) {
        const valuesStr = row.values.slice(0, 3).map(v => v ?? "null").join(", ");
        sourceLabels.push({
          section: section.code,
          label: row.label,
          values: valuesStr,
        });
      }
    }
  }

  const prompt = `You are a financial data mapping expert. Match source PDF labels to target template cells using LABEL SIMILARITY.

SOURCE LABELS (from PDF):
${sourceLabels.map(s => `[${s.section}] "${s.label}" → values: ${s.values}`).join("\n")}

TARGET CELLS (template):
${templateCells.map(t => `Row ${t.row}: ${t.label} (expected: ${t.expectedSign ?? "any sign"})`).join("\n")}

For each target cell, find the BEST matching source label based on:
1. Exact or partial label match (same words, translations, abbreviations)
2. Standard financial statement position (Revenue at top, Net Income at bottom)
3. Sign conventions (costs/expenses are typically shown negative or need negation)

Return JSON array:
[{
  "targetRow": number,
  "sourceLabel": "exact label from PDF",
  "sourceSection": "section code",
  "valueTransform": "divide_1000000" | "negate_divide_1000000" | "divide_1000" | "negate" | null,
  "confidence": 0.0-1.0,
  "reasoning": "why this match"
}]

Only include matches with confidence >= 0.5. Return valid JSON only.`;

  const result = await generateText({
    model: openrouter("anthropic/claude-haiku-3"),
    messages: [{ role: "user", content: prompt }],
  });

  let text = result.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(text) as Array<{
    targetRow: number;
    sourceLabel: string;
    sourceSection: string;
    valueTransform: string | null;
    confidence: number;
    reasoning: string;
  }>;

  const results: MappingCandidate[] = [];
  for (const p of parsed) {
    const target = templateCells.find(t => t.row === p.targetRow);
    if (!target) continue;
    results.push({
      target,
      sourceLabel: p.sourceLabel,
      sourceSection: p.sourceSection,
      valueTransform: p.valueTransform,
      confidence: p.confidence,
      proposedBy: "A",
      reasoning: p.reasoning,
    });
  }
  return results;
}

// ── Agent B: Value Patterns ──────────────────────────────────────────────────

async function runAgentB(
  sections: PdfSection[],
  templateCells: TemplateCell[]
): Promise<MappingCandidate[]> {
  const openrouter = getOpenRouter();

  // Build source data with values
  const sourceRows: { section: string; label: string; value: number | null }[] = [];
  for (const section of sections) {
    for (const table of section.tables) {
      for (const row of table.rows) {
        // Take first non-null value as representative
        const value = row.values.find(v => v !== null) ?? null;
        sourceRows.push({
          section: section.code,
          label: row.label,
          value,
        });
      }
    }
  }

  const prompt = `You are a financial data mapping expert. Match source PDF rows to target template cells using VALUE PATTERNS and ARITHMETIC RELATIONSHIPS.

SOURCE DATA (from PDF):
${sourceRows.map(s => `[${s.section}] "${s.label}" = ${s.value ?? "null"}`).join("\n")}

TARGET CELLS (template):
${templateCells.map(t => `Row ${t.row}: ${t.label}`).join("\n")}

Analyze the numbers to find mappings:
1. Gross Profit = Revenue - Cost of Sales (check if values satisfy this)
2. Operating Income = Gross Profit - Operating Expenses
3. Total Assets = Total Liabilities + Total Equity
4. Magnitude patterns (values in millions vs thousands)
5. Sign patterns (which values are negative)

Return JSON array:
[{
  "targetRow": number,
  "sourceLabel": "exact label from PDF",
  "sourceSection": "section code",
  "valueTransform": "divide_1000000" | "negate_divide_1000000" | "divide_1000" | "negate" | null,
  "confidence": 0.0-1.0,
  "reasoning": "why this match based on value analysis"
}]

Only include matches with confidence >= 0.5. Return valid JSON only.`;

  const result = await generateText({
    model: openrouter("anthropic/claude-haiku-3"),
    messages: [{ role: "user", content: prompt }],
  });

  let text = result.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(text) as Array<{
    targetRow: number;
    sourceLabel: string;
    sourceSection: string;
    valueTransform: string | null;
    confidence: number;
    reasoning: string;
  }>;

  const results: MappingCandidate[] = [];
  for (const p of parsed) {
    const target = templateCells.find(t => t.row === p.targetRow);
    if (!target) continue;
    results.push({
      target,
      sourceLabel: p.sourceLabel,
      sourceSection: p.sourceSection,
      valueTransform: p.valueTransform,
      confidence: p.confidence,
      proposedBy: "B",
      reasoning: p.reasoning,
    });
  }
  return results;
}

// ── Synthesis Judge ──────────────────────────────────────────────────────────

async function synthesizeCandidates(
  agentACandidates: MappingCandidate[],
  agentBCandidates: MappingCandidate[],
  templateCells: TemplateCell[]
): Promise<MappingCandidate[]> {
  const openrouter = getOpenRouter();

  // Group by target row
  const byTarget = new Map<number, MappingCandidate[]>();
  for (const c of [...agentACandidates, ...agentBCandidates]) {
    const key = c.target.row;
    const existing = byTarget.get(key) ?? [];
    existing.push(c);
    byTarget.set(key, existing);
  }

  // For targets with conflicting candidates, ask judge to synthesize
  const synthesized: MappingCandidate[] = [];
  const conflicts: Array<{ targetRow: number; candidates: MappingCandidate[] }> = [];

  for (const [targetRow, candidates] of byTarget) {
    if (candidates.length === 1) {
      // No conflict, keep as-is
      synthesized.push(candidates[0]);
    } else if (candidates.every(c => c.sourceLabel === candidates[0].sourceLabel)) {
      // Same mapping from both agents, boost confidence
      const best = candidates.reduce((a, b) => a.confidence > b.confidence ? a : b);
      synthesized.push({
        ...best,
        confidence: Math.min(1.0, best.confidence * 1.2),
        proposedBy: "AB",
        reasoning: `Both agents agree: ${best.reasoning}`,
      });
    } else {
      // Conflict, need synthesis
      conflicts.push({ targetRow, candidates });
    }
  }

  if (conflicts.length === 0) {
    return synthesized;
  }

  // Ask judge to resolve conflicts
  const conflictDesc = conflicts.map(c => {
    const target = templateCells.find(t => t.row === c.targetRow);
    return `Target Row ${c.targetRow} (${target?.label}):
${c.candidates.map(cand => `  - ${cand.proposedBy}: "${cand.sourceLabel}" (${(cand.confidence * 100).toFixed(0)}%) — ${cand.reasoning}`).join("\n")}`;
  }).join("\n\n");

  const prompt = `You are a financial mapping judge. Two agents proposed different mappings. Decide which is correct.

CONFLICTS:
${conflictDesc}

For each conflict, pick the better mapping or synthesize a new one. Consider:
1. Label similarity strength
2. Value pattern evidence
3. Financial statement conventions

Return JSON array:
[{
  "targetRow": number,
  "sourceLabel": "chosen label",
  "sourceSection": "section code",
  "valueTransform": "transform or null",
  "confidence": 0.0-1.0,
  "reasoning": "why this is the correct mapping"
}]

Return valid JSON only.`;

  const result = await generateText({
    model: openrouter("anthropic/claude-haiku-3"),
    messages: [{ role: "user", content: prompt }],
  });

  let text = result.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const judged = JSON.parse(text) as Array<{
    targetRow: number;
    sourceLabel: string;
    sourceSection: string;
    valueTransform: string | null;
    confidence: number;
    reasoning: string;
  }>;

  for (const j of judged) {
    const target = templateCells.find(t => t.row === j.targetRow);
    if (!target) continue;
    synthesized.push({
      target,
      sourceLabel: j.sourceLabel,
      sourceSection: j.sourceSection,
      valueTransform: j.valueTransform,
      confidence: j.confidence,
      proposedBy: "AB",
      reasoning: j.reasoning,
    });
  }

  return synthesized;
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Suggest mappings for a new company using autoreason-style debate.
 *
 * @param sections - Extracted PDF sections
 * @param customTemplate - Optional custom template cells (defaults to PROJ)
 * @returns Ranked mapping candidates grouped by target cell
 */
export async function suggestMappings(
  sections: PdfSection[],
  customTemplate?: TemplateCell[]
): Promise<SuggestionResult> {
  const startTime = Date.now();
  const templateCells = customTemplate ?? PROJ_TEMPLATE_CELLS;

  // Run both agents in parallel
  const [agentACandidates, agentBCandidates] = await Promise.all([
    runAgentA(sections, templateCells),
    runAgentB(sections, templateCells),
  ]);

  // Synthesize candidates
  const candidates = await synthesizeCandidates(
    agentACandidates,
    agentBCandidates,
    templateCells
  );

  // Group by target and sort by confidence
  const byTarget = new Map<string, MappingCandidate[]>();
  for (const c of candidates) {
    const key = `${c.target.sheet}:${c.target.row}`;
    const existing = byTarget.get(key) ?? [];
    existing.push(c);
    byTarget.set(key, existing);
  }

  // Sort each group by confidence descending
  for (const [key, group] of byTarget) {
    byTarget.set(key, group.sort((a, b) => b.confidence - a.confidence));
  }

  return {
    candidates,
    byTarget,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Convert confirmed candidates to field mapping insert values.
 */
export function candidatesToMappings(
  candidates: MappingCandidate[],
  companyId: number,
  baseQuarter: string = "1Q25"
): Array<{
  companyId: number;
  colMode: "quarterly_offset";
  sourceSection: string;
  sourceLabel: string;
  targetSheet: string;
  targetRow: number;
  targetColBase: string;
  targetColStep: number;
  baseQuarter: string;
  valueTransform: string | null;
  sourceRow?: number | null;
  sourceCol?: string | null;
  validationSign: string | null;
}> {
  return candidates.map(c => ({
    companyId,
    colMode: "quarterly_offset" as const,
    sourceSection: c.sourceSection,
    sourceLabel: c.sourceLabel,
    sourceRow: c.sourceRow ?? undefined,
    sourceCol: c.sourceCol ?? undefined,
    targetSheet: c.target.sheet,
    targetRow: c.target.row,
    targetColBase: c.targetColBase ?? c.target.colLetter ?? "B",
    targetColStep: 1,
    baseQuarter,
    valueTransform: c.valueTransform,
    validationSign: c.target.expectedSign,
  }));
}
