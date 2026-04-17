import { getTargetCol, quarterToColOffset } from "./quarter";

export interface TargetCellInput {
  baseQuarter: string;
  colMode: string | null;
  quarter: string;
  targetColBase: string;
  targetColStep: number | null;
  targetRow: number;
  targetSheet: string;
}

export function getTargetCellAddress(input: TargetCellInput): string {
  const col =
    input.colMode === "fixed"
      ? input.targetColBase
      : getTargetCol(
          input.targetColBase,
          input.targetColStep ?? 1,
          quarterToColOffset(input.quarter, input.baseQuarter),
        );

  return `${input.targetSheet}!${col}${input.targetRow}`;
}
