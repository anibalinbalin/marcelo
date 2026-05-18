import type { Expectations } from "./types";

export const expectations: Expectations = {
  companyId: 8,
  ticker: "NTCO3",
  quarter: "4Q25",
  sourceKind: "excel",
  sourceFile:
    "/Users/anibalin/Sites/2026/marcelo/public/camila/Natura_Planilha_Resultados_download.xlsx",
  minExtractedValues: 12,

  projPreApprovalCells: {
    "PROJ:r3":  { value: 8261.841304, label: "Gross revenues" },
    "PROJ:r4":  { value: -2066.893603, label: "Deductions" },
    "PROJ:r7":  { value: -2198.869761, label: "COGS" },
    "PROJ:r42": { value: -321.167372, label: "Net income" },
    "PROJ:r40": { value: -507.098557, label: "Discontinued operations" },
    "PROJ:r26": { value: -127.69261, label: "Net financials" },
  },

  fatSheet: "FAT",
  fatAfterRecalc: {},

  projDuplicatePairs: [],

  acceptedValidationWarnings: [],
};
