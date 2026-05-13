import { describe, expect, it } from "vitest";
import {
  SOURCE_GUARD_FAILED,
  runSourceGuards,
  type SourceGuardValue,
} from "../source-guards";

function value(id: number, sourceLabel: string, extractedValue: number): SourceGuardValue {
  return {
    id,
    sourceLabel,
    sourceSection: "press_release",
    extractedValue: extractedValue.toFixed(6),
  };
}

const validBimboValues = [
  value(1, "Ventas Netas|Norteamérica", 40533),
  value(2, "Ventas Netas|México", 39726),
  value(3, "Ventas Netas|EAA", 12631),
  value(4, "Ventas Netas|Latinoamérica", 11545),
  value(5, "Utilidad Bruta|Norteamérica", 21997),
  value(6, "Utilidad Bruta|México", 21952),
  value(7, "Utilidad Bruta|EAA", 4390),
  value(8, "Utilidad Bruta|Latinoamérica", 4945),
  value(9, "Utilidad de Operación|Norteamérica", 1178),
  value(10, "Utilidad de Operación|México", 6044),
  value(11, "Utilidad de Operación|EAA", 330),
  value(12, "Utilidad de Operación|Latinoamérica", 228),
  value(13, "UAFIDA Ajustada|Norteamérica", 3468),
  value(14, "UAFIDA Ajustada|México", 8159),
  value(15, "UAFIDA Ajustada|EAA", 1116),
  value(16, "UAFIDA Ajustada|Latinoamérica", 1057),
];

describe("runSourceGuards", () => {
  it("passes the complete BIMBO press-release group", () => {
    expect(runSourceGuards(1, validBimboValues)).toEqual([]);
  });

  it("fails when gross profit collapses to operating profit", () => {
    const badValues = validBimboValues.map((entry) =>
      entry.sourceLabel === "Utilidad Bruta|México"
        ? { ...entry, extractedValue: "6044.000000" }
        : entry,
    );

    const failures = runSourceGuards(1, badValues);

    expect(failures).toEqual([
      expect.objectContaining({
        valueId: 6,
        sourceLabel: "Utilidad Bruta|México",
      }),
    ]);
    expect(SOURCE_GUARD_FAILED).toBe("source_guard_failed");
  });

  it("fails when a required BIMBO press-release value is missing", () => {
    const failures = runSourceGuards(
      1,
      validBimboValues.filter(
        (entry) => entry.sourceLabel !== "Utilidad Bruta|Latinoamérica",
      ),
    );

    expect(failures).toContainEqual(
      expect.objectContaining({
        valueId: null,
        sourceLabel: "Utilidad Bruta|Latinoamérica",
      }),
    );
  });

  it("does not apply BIMBO guards to other companies", () => {
    expect(runSourceGuards(7, [])).toEqual([]);
  });
});

