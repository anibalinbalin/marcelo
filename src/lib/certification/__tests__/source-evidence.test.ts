import { describe, expect, it } from "vitest";
import {
  buildIfrsTextJudgeEvidence,
  buildPdfSectionJudgeEvidence,
  missingEvidenceLabels,
} from "../source-evidence";

describe("source evidence certification helpers", () => {
  it("builds bounded PDF section evidence with labels and values", () => {
    const evidence = buildPdfSectionJudgeEvidence([
      {
        code: "[310000]",
        pages: [1],
        tables: [
          {
            page: 1,
            headers: [],
            rows: [
              { label: "Ingresos", values: [100, null] },
              { label: "Utilidad bruta", values: [40] },
            ],
          },
        ],
      },
    ]);

    expect(evidence).toContain('section=[310000] page=1 label="Ingresos" values=100');
    expect(evidence).toContain('label="Utilidad bruta" values=40');
  });

  it("builds IFRS text evidence with pages", () => {
    const evidence = buildIfrsTextJudgeEvidence([
      { page: 4, label: "Total de activos", values: [12565.969] },
    ]);

    expect(evidence).toBe('page=4 label="Total de activos" values=12565.969');
  });

  it("reports missing evidence labels case-insensitively", () => {
    const evidence = 'page=4 label="Total de activos" values=12565.969';

    expect(missingEvidenceLabels(evidence, ["total de activos", "Resultado neto"])).toEqual([
      "Resultado neto",
    ]);
  });
});
