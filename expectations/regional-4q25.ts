import type { Expectations } from "./types";

export const expectations: Expectations = {
  companyId: 6,
  ticker: "REGIONAL",
  quarter: "4Q25",
  sourceFile:
    "/Users/anibalin/Sites/2026/marcelo/public/camila/RA Banregio 4T25.pdf",
  minExtractedValues: 12,

  projPreApprovalCells: {
    "PROJ:r5":  { value: 4020, label: "Margen financiero" },
    "PROJ:r6":  { value: 7566, label: "Ingresos por intereses" },
    "PROJ:r7":  { value: -3546, label: "Gastos por intereses" },
    "PROJ:r9":  { value: -471, label: "Estimación preventiva para riesgos crediticios" },
    "PROJ:r12": { value: -2031, label: "Gastos de Operación" },
    "PROJ:r14": { value: 2478, label: "Resultado de la operación" },
    "PROJ:r16": { value: -616, label: "I.s.r. y p.t.u. causados" },
    "PROJ:r20": { value: 1824, label: "Resultado neto" },
    "PROJ:r28": { value: 277162, label: "TOTAL ACTIVO" },
    "PROJ:r29": { value: 18232, label: "Efectivo y Equivalentes de Efectivo" },
    "PROJ:r30": { value: 56031, label: "Inversiones en Instrumentos Financieros" },
    "PROJ:r31": { value: 491, label: "Instrumentos Financieros Derivados" },
    "PROJ:r51": { value: 241146, label: "TOTAL PASIVO" },
    "PROJ:r52": { value: 190557, label: "Captación tradicional" },
    "PROJ:r67": { value: 36031, label: "TOTAL CAPITAL CONTABLE" },
  },

  fatSheet: "FAT",
  fatAfterRecalc: {},

  // r9 (IS) and r42 (BS) share the label "Estimación preventiva..."
  // but r42 has no data in the 4Q25 source — pair check deferred
  // until a quarter where both are populated.
  projDuplicatePairs: [],

  acceptedValidationWarnings: [
    /DeepSeek source judge.*[Ee]vidence snippet does not/,
    /DeepSeek source judge.*[Ii]nsufficient evidence/,
    /DeepSeek source judge.*[Cc]annot verify/,
  ],
};
