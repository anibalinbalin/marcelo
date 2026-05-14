import type { Expectations } from "./types";

export const expectations: Expectations = {
  companyId: 5,
  ticker: "KIMBER",
  quarter: "4Q25",
  sourceFile:
    "/Users/anibalin/Sites/2026/marcelo/public/camila/ReporteTrimestral_KIMBER_2025_4D_111323-260211-dc210583_1770875016982 (2).pdf",
  minExtractedValues: 18,

  projPreApprovalCells: {
    "PROJ:r3":  { value: 14057.927, label: "Ingresos" },
    "PROJ:r6":  { value: 5680.039, label: "Utilidad bruta" },
    "PROJ:r10": { value: -1768.048, label: "Gastos de venta" },
    "PROJ:r11": { value: -699.256, label: "Gastos de administración" },
    "PROJ:r12": { value: 2.604, label: "Otros ingresos" },
    "PROJ:r18": { value: 113.351, label: "Ingresos financieros" },
    "PROJ:r19": { value: -512.189, label: "Gastos financieros" },
    "PROJ:r24": { value: -621.112, label: "Impuestos a la utilidad" },
    "PROJ:r26": { value: 0, label: "Utilidad (pérdida) atribuible a la participación no controladora" },
    "PROJ:r56": { value: 9660.279, label: "Efectivo y equivalentes de efectivo" },
    "PROJ:r57": { value: 8670.669, label: "Clientes y otras cuentas por cobrar" },
    "PROJ:r59": { value: 4309.261, label: "Inventarios" },
    "PROJ:r63": { value: 22640.209, label: "Total de activos circulantes" },
    "PROJ:r67": { value: 19126.452, label: "Propiedades, planta y equipo" },
    "PROJ:r72": { value: 22992.947, label: "Total de activos no circulantes" },
    "PROJ:r75": { value: 1509.011, label: "Otros pasivos financieros a corto plazo" },
    "PROJ:r76": { value: 11293.771, label: "Proveedores y otras cuentas por pagar a corto plazo" },
    "PROJ:r80": { value: 15570.051, label: "Total de pasivos circulantes" },
    "PROJ:r82": { value: 21674.134, label: "Otros pasivos financieros a largo plazo" },
    "PROJ:r85": { value: 22826.755, label: "Total de pasivos a Largo plazo" },
    "PROJ:r88": { value: 7236.350, label: "Total de la participación controladora" },
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
