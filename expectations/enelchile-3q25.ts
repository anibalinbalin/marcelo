import type { Expectations } from "./types";

export const expectations: Expectations = {
  companyId: 3,
  ticker: "ENELCHILE",
  quarter: "3Q25",
  sourceFile:
    "/Users/anibalin/Sites/2026/marcelo/public/camila/Estados_Financieros_Enel_Chile_3Q25.pdf",
  minExtractedValues: 18,

  projPreApprovalCells: {
    "Consolidado:r11": { value: 1145.082, label: "Ingresos de actividades ordinarias" },
    "Consolidado:r15": { value: -745.379, label: "Materias primas y consumibles utilizados" },
    "Consolidado:r19": { value: 455.039, label: "Margen de contribución" },
    "Consolidado:r21": { value: -75.106, label: "Otros gastos por naturaleza" },
    "Consolidado:r22": { value: 228.590, label: "Resultado operacional" },
    "Consolidado:r24": { value: 11.631, label: "Ingresos financieros" },
    "Consolidado:r25": { value: -66.511, label: "Costos financieros" },
    "Consolidado:r26": { value: -0.172, label: "Resultado por unidades de reajuste" },
    "Consolidado:r27": { value: -18.057, label: "Ganancias (pérdidas) de cambio en moneda extranjera" },
    "Consolidado:r31": { value: -43.746, label: "Ingreso (gasto) por impuestos a las ganancias" },
    "Consolidado:r35": { value: 117.109, label: "Ganancia del periodo" },
    "Consolidado:r37": { value: 10.934, label: "Ganancia (pérdida) atribuible a participaciones no controladoras" },
    "Consolidado:r40": { value: 373.302, label: "Efectivo y equivalentes al efectivo" },
    "Consolidado:r42": { value: 2090.634, label: "Total de activos corrientes" },
    "Consolidado:r47": { value: 12565.969, label: "Total de activos" },
    "Consolidado:r51": { value: 1925.572, label: "Total de pasivos corrientes" },
    "Consolidado:r56": { value: 7095.226, label: "Total pasivos" },
    "Consolidado:r58": { value: 371.396, label: "Participaciones no controladoras" },
    "Consolidado:r60": { value: 5470.743, label: "Total de patrimonio" },
    "Consolidado:r89": { value: -21.293, label: "pasivos por arrendamiento" },
    "Consolidado:r90": { value: -348.018, label: "Dividendos pagados" },
    "Consolidado:r91": { value: -104.629, label: "Intereses pagados" },
  },

  fatSheet: "FAT",
  fatAfterRecalc: {},

  projDuplicatePairs: [],

  acceptedValidationWarnings: [
    /DeepSeek source judge.*[Ee]vidence snippet does not/,
    /DeepSeek source judge.*[Ii]nsufficient evidence/,
    /DeepSeek source judge.*[Cc]annot verify/,
  ],
};
