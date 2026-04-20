import { describe, expect, it } from "vitest";
import {
  LREN3_CANONICAL_MAPPINGS,
  LREN3_EXPECTED_MAPPING_COUNT,
  LREN3_FAT_FORMULA_ROWS,
  LREN3_FAT_LITERAL_ROWS,
  LREN3_PROJ_FORMULA_ROWS,
} from "../lren3-canonical";
import { getTargetCellAddress } from "../../lib/target-cell";

describe("LREN3 canonical mappings", () => {
  it("keeps the expected mapping count", () => {
    expect(LREN3_CANONICAL_MAPPINGS).toHaveLength(LREN3_EXPECTED_MAPPING_COUNT);
  });

  it("covers Camila's FAT literal rows in column CL for 4Q25", () => {
    for (const row of LREN3_FAT_LITERAL_ROWS) {
      const mapping = LREN3_CANONICAL_MAPPINGS.find(
        (candidate) =>
          candidate.targetSheet === "FAT" && candidate.targetRow === row,
      );

      expect(mapping, `missing FAT row ${row}`).toBeDefined();
      expect(
        getTargetCellAddress({
          baseQuarter: mapping!.baseQuarter,
          colMode: mapping!.colMode,
          quarter: "4Q25",
          targetColBase: mapping!.targetColBase,
          targetColStep: mapping!.targetColStep,
          targetRow: mapping!.targetRow,
          targetSheet: mapping!.targetSheet,
        }),
      ).toBe(`FAT!CL${row}`);
    }
  });

  it("keeps FAT formula rows unmapped", () => {
    for (const row of LREN3_FAT_FORMULA_ROWS) {
      const mapping = LREN3_CANONICAL_MAPPINGS.find(
        (candidate) =>
          candidate.targetSheet === "FAT" && candidate.targetRow === row,
      );

      expect(mapping).toBeUndefined();
    }
  });

  it("keeps PROJ total rows unmapped so template formulas survive", () => {
    for (const row of LREN3_PROJ_FORMULA_ROWS) {
      const mapping = LREN3_CANONICAL_MAPPINGS.find(
        (candidate) =>
          candidate.targetSheet === "PROJ" && candidate.targetRow === row,
      );

      expect(mapping).toBeUndefined();
    }
  });

  it("includes the new operating-data and capex actual rows", () => {
    for (const targetRow of [223, 225, 227, 229, 235, 237, 239, 241, 245, 247, 249, 251, 300, 368, 383, 394, 400]) {
      const mapping = LREN3_CANONICAL_MAPPINGS.find(
        (candidate) => candidate.targetSheet === "FAT" && candidate.targetRow === targetRow,
      );
      expect(mapping, `missing FAT row ${targetRow}`).toBeDefined();
    }

    for (const targetRow of [18, 101]) {
      const mapping = LREN3_CANONICAL_MAPPINGS.find(
        (candidate) => candidate.targetSheet === "PROJ" && candidate.targetRow === targetRow,
      );
      expect(mapping, `missing PROJ row ${targetRow}`).toBeDefined();
    }
  });
});
