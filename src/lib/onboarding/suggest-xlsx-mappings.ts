import * as ExcelJS from "exceljs";
import { colNumberToLetter } from "../excel/reader";
import type { MappingCandidate, SuggestionResult, TemplateCell } from "./suggest-mappings";

type SourceRow = {
  section: string;
  sheetName: string;
  row: number;
  label: string;
  value: number;
  address: string;
  sourceCol: string | null;
};

type TargetValue = {
  target: TemplateCell;
  value: number;
  address: string;
};

const TRANSFORMS: Array<{ name: string | null; apply: (value: number) => number }> = [
  { name: "divide_1000", apply: (value) => value / 1000 },
  { name: "negate_divide_1000", apply: (value) => -value / 1000 },
  { name: "divide_1000000", apply: (value) => value / 1000000 },
  { name: "negate_divide_1000000", apply: (value) => -value / 1000000 },
  { name: null, apply: (value) => value },
  { name: "negate", apply: (value) => -value },
];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(normalizeText(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalizeText(b).split(/\s+/).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return overlap / Math.max(left.size, right.size);
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  const raw = value && typeof value === "object" && "result" in value ? value.result : value;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return null;
  if (typeof value === "object" && "richText" in value) {
    const text = value.richText.map((part) => part.text).join("").trim();
    return text || null;
  }
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim() || null;
  }
  return String(value).trim() || null;
}

function bivaSection(sheetName: string): string {
  const match = sheetName.trim().match(/^(\d{6})/);
  return match ? `[${match[1]}]` : sheetName;
}

function detectDataColumn(sheet: ExcelJS.Worksheet): { col: number; header: string | null } {
  for (const row of [3, 4, 2, 6]) {
    for (let col = 2; col <= Math.min(sheet.columnCount, 12); col++) {
      const text = cellText(sheet.getCell(row, col).value);
      if (text && /a[nñ]o\s*actual|trimestre\s*actual|current/i.test(text)) {
        return { col, header: text };
      }
    }
  }
  return { col: 2, header: cellText(sheet.getCell(3, 2).value) };
}

function readSourceRows(workbook: ExcelJS.Workbook): SourceRow[] {
  const rows: SourceRow[] = [];
  workbook.eachSheet((sheet) => {
    if (/^(PROJ|FAT|RESUMO)$/i.test(sheet.name.trim())) return;
    const { col, header } = detectDataColumn(sheet);
    for (let row = 3; row <= sheet.rowCount; row++) {
      const label =
        cellText(sheet.getCell(row, 1).value) ??
        cellText(sheet.getCell(row, 2).value) ??
        cellText(sheet.getCell(row, 3).value);
      if (!label) continue;
      const value = cellNumber(sheet.getCell(row, col).value);
      if (value == null) continue;
      rows.push({
        section: bivaSection(sheet.name),
        sheetName: sheet.name,
        row,
        label,
        value,
        address: `${sheet.name}!${colNumberToLetter(col)}${row}`,
        sourceCol: header,
      });
    }
  });
  return rows;
}

function targetLabel(sheet: ExcelJS.Worksheet, row: number): string | null {
  for (const col of [1, 2, 3, 4]) {
    const text = cellText(sheet.getCell(row, col).value);
    if (text && !/^\d/.test(text)) return text;
  }
  return null;
}

function readTargets(workbook: ExcelJS.Workbook): TargetValue[] {
  const sheet = workbook.getWorksheet("PROJ");
  if (!sheet) return [];
  const targets: TargetValue[] = [];
  const seenRows = new Set<number>();
  for (let row = 1; row <= Math.min(sheet.rowCount, 180); row++) {
    const label = targetLabel(sheet, row);
    if (!label) continue;
    for (let col = 2; col <= Math.min(sheet.columnCount, 80); col++) {
      const value = cellNumber(sheet.getCell(row, col).value);
      if (value == null || Math.abs(value) < 0.000001) continue;
      if (seenRows.has(row)) continue;
      seenRows.add(row);
      const colLetter = colNumberToLetter(col);
      targets.push({
        target: {
          sheet: "PROJ",
          row,
          col,
          colLetter,
          label,
          expectedSign: value < 0 ? "negative" : "positive",
        },
        value,
        address: `PROJ!${colLetter}${row}`,
      });
      break;
    }
  }
  return targets;
}

function closeEnough(a: number, b: number): boolean {
  const tolerance = Math.max(1, Math.abs(b) * 0.0005);
  return Math.abs(a - b) <= tolerance;
}

function bestCandidateForTarget(target: TargetValue, sourceRows: SourceRow[]): MappingCandidate | null {
  let best: MappingCandidate | null = null;
  for (const source of sourceRows) {
    for (const transform of TRANSFORMS) {
      const transformed = transform.apply(source.value);
      if (!closeEnough(transformed, target.value)) continue;
      const similarity = tokenSimilarity(source.label, target.target.label);
      const confidence = Math.min(0.99, 0.72 + similarity * 0.24 + (transform.name ? 0.02 : 0));
      const candidate: MappingCandidate = {
        target: target.target,
        sourceLabel: source.label,
        sourceSection: source.section,
        sourceRow: source.row,
        sourceCol: source.sourceCol,
        targetColBase: target.target.colLetter,
        valueTransform: transform.name,
        confidence,
        proposedBy: "XLSX",
        reasoning:
          `Matched Camila's ${target.address} value ${target.value} to ${source.address} ` +
          `using ${transform.name ?? "no transform"}; label similarity ${(similarity * 100).toFixed(0)}%.`,
        evidence: {
          sourceValue: source.value,
          targetValue: target.value,
          transformedValue: transformed,
          sourceAddress: source.address,
          targetAddress: target.address,
          transform: transform.name,
        },
      };
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
  }
  return best;
}

export async function suggestXlsxMappings(
  baseModelBuffer: Buffer,
  sourceBuffer: Buffer,
): Promise<SuggestionResult> {
  const startTime = Date.now();
  const [baseWorkbook, sourceWorkbook] = [new ExcelJS.Workbook(), new ExcelJS.Workbook()];
  await Promise.all([
    baseWorkbook.xlsx.load(baseModelBuffer as never),
    sourceWorkbook.xlsx.load(sourceBuffer as never),
  ]);

  const sourceRows = readSourceRows(sourceWorkbook);
  const targets = readTargets(baseWorkbook);
  const candidates = targets
    .map((target) => bestCandidateForTarget(target, sourceRows))
    .filter((candidate): candidate is MappingCandidate => candidate !== null)
    .sort((a, b) => b.confidence - a.confidence);

  const byTarget = new Map<string, MappingCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.target.sheet}:${candidate.target.row}`;
    const existing = byTarget.get(key) ?? [];
    existing.push(candidate);
    byTarget.set(key, existing);
  }

  return {
    candidates,
    byTarget,
    durationMs: Date.now() - startTime,
  };
}
