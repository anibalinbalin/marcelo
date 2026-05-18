import type { Expectations } from "./types";

export const expectations: Expectations = {
  companyId: 2,
  ticker: "CENT",
  quarter: "4Q25",
  sourceKind: "excel",
  sourceFile:
    "/Users/anibalin/Sites/2026/marcelo/public/camila/Planilha_Interativa_4T25_CENT.xlsx",
  minExtractedValues: 30,

  projPreApprovalCells: {
    "PROJ:r3":   { value: 3015626, label: "Gross revenue" },
    "PROJ:r5":   { value: 2427832, label: "Net revenue" },
    "PROJ:r8":   { value: -1274693, label: "Cost of sales" },
    "PROJ:r9":   { value: 1153139, label: "Gross profit" },
    "PROJ:r32":  { value: 127065.256967, label: "Net income for period (ex-IFRS16)" },
    "PROJ:r91":  { value: 679969, label: "Cash and cash equivalents" },
    "PROJ:r93":  { value: 2030987, label: "Inventory" },
    "PROJ:r106": { value: 9522546, label: "Total assets" },
    "PROJ:r107": { value: 3739772, label: "Current liabilities" },
    "PROJ:r124": { value: 3059794, label: "Shareholders' equity" },
    "PROJ:r126": { value: 9522546, label: "Total liabilities and shareholders' equity" },
  },

  fatSheet: "FAT",
  fatAfterRecalc: {},

  projDuplicatePairs: [],

  acceptedValidationWarnings: [],
};
