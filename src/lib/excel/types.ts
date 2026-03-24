export interface BlueCellInfo {
  sheet: string;
  row: number;
  col: number;
  colLetter: string;
  value: number | string | null;
  fontColor: string;
}

export interface FontColorInfo {
  hex: string;
  count: number;
  sampleCells: string[];
}

export interface ExtractedField {
  sourceLabel: string;
  sectionCode: string | null;
  value: number | null;
  period: string;
  currency: string | null;
  unit: string | null;
}

export interface IntegrityReport {
  sheetCountMatch: boolean;
  formulaCountMatch: Record<
    string,
    { original: number; output: number; match: boolean }
  >;
  writtenCellsVerified: boolean;
  errors: string[];
}
