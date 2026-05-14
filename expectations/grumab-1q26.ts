import type { Expectations } from "./types";

export const expectations: Expectations = {
  companyId: 9,
  ticker: "GRUMAB",
  quarter: "1Q26",
  sourceFile:
    "/Users/anibalin/Sites/2026/marcelo/public/camila/ReporteTrimestral_GRUMA_1Q26.xlsx",
  minExtractedValues: 30,

  projPreApprovalCells: {
    "PROJ:r3":  { value: 1624728, label: "Ingresos" },
    "PROJ:r5":  { value: -995966, label: "Costo de ventas" },
    "PROJ:r6":  { value: 628762, label: "Utilidad bruta" },
    "PROJ:r14": { value: 189164, label: "Utilidad (pérdida) de operación" },
    "PROJ:r23": { value: 154382, label: "Utilidad (pérdida) antes de impuestos" },
    "PROJ:r27": { value: 100643, label: "Utilidad (pérdida) atribuible a la participación controladora" },
    "PROJ:r56": { value: 419118, label: "Efectivo y equivalentes de efectivo" },
    "PROJ:r59": { value: 1147770, label: "Inventarios" },
    "PROJ:r73": { value: 5086556, label: "Total de activos" },
    "PROJ:r90": { value: 2770017, label: "Total pasivos" },
    "PROJ:r88": { value: 2313725, label: "Total de la participación controladora" },
  },

  fatSheet: "FAT",
  fatAfterRecalc: {},

  projDuplicatePairs: [],

  acceptedValidationWarnings: [
    /Flujos de efectivo netos procedentes de \(utilizados en\) actividades de financiaci/,
  ],
};
