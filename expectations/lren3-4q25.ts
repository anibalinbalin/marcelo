/**
 * LREN3 (Lojas Renner) 4Q25 expectations — what Camila verifies after
 * approving the extraction.
 *
 * Scope: catch the three bug classes found on 2026-04-15
 *   - Bug A (contamination): source_row=57 placeholder pulled one line
 *     into 31 unrelated BS rows. Covered by minExtractedValues + the
 *     FAT recalc targets (anything wrong propagates downstream).
 *   - Bug B (FAT staleness): FAT formulas never referenced PROJ. Covered
 *     directly by fatAfterRecalc: if the new FAT mappings aren't writing,
 *     downstream formulas stay at template projections. 2026-04-16 expanded
 *     to 16 more raw IS/EBITDA line items after Camila reported a gap sweep.
 *     CL53 intentionally NOT pinned — it stays as the template formula
 *     =+CL258 per Camila's convention (derived rows keep formulas).
 *   - Bug C (duplicate-label collapse): 12 mappings share labels between
 *     current and long-term BS rows. Covered by projDuplicatePairs.
 *
 * fatAfterRecalc tolerances are from the post-fix Excel readback proven
 * on 2026-04-15. CL38/CL49 carry ~1K residual drift from the historical-
 * avg CL20/CL23 rows that we intentionally left alone.
 */
import type { Expectations } from "./types";

export const expectations: Expectations = {
  companyId: 7,
  ticker: "LREN3",
  quarter: "4Q25",
  sourceFile:
    "/Users/anibalin/Sites/2026/marcelo/public/camila/Renner Planilhas e Fundamentos  (6).xlsx",
  minExtractedValues: 60,

  projPreApprovalCells: {
    // Contamination canaries: these were the rows silently collapsed
    // to wrong values on 2026-04-15. Pin each to the exact value
    // extracted from the source at its mapped source_row.
    "PROJ:r94":  { value: 470036,  label: "Recoverable Taxes (current)" },
    "PROJ:r99":  { value: 368725,  label: "Recoverable Taxes (LT)" },
    "PROJ:r109": { value: 1774432, label: "Suppliers (was 71593 during bug)" },
    "PROJ:r112": { value: 740237,  label: "Financing Lease (current)" },
    "PROJ:r122": { value: 1765254, label: "Financing Lease (LT)" },
    "PROJ:r113": { value: 21087,   label: "Financial Products (current)" },
    "PROJ:r121": { value: 358788,  label: "Financial Products (LT)" },
    "PROJ:r118": { value: 341502,  label: "Other Current Liabilities (current)" },
    "PROJ:r125": { value: 41574,   label: "Other Accounts Payable (LT)" },
  },

  fatSheet: "FAT",
  fatAfterRecalc: {
    CL3: { value: 6218032, label: "Receita Bruta" },
    CL7: { value: 5691983, label: "Vendas de Mercadorias (gross)" },
    CL11: { value: 526049, label: "Receita Bruta de Serviços" },
    CL15: { value: -1377186, label: "Deduções", tolerance: 2 },
    CL26: { value: 4840846, label: "Receita Líquida" },
    CL30: { value: 4352522, label: "Net Retailing" },
    CL34: { value: 488324, label: "Net Financial Services" },
    CL38: { value: -1885396, label: "CPV", tolerance: 2000 },
    CL41: { value: -1891423, label: "CPV Retail" },
    CL44: { value: 7099, label: "CPV Financeiro" },
    CL49: { value: 2955450, label: "Lucro Bruto", tolerance: 2000 },
    CL73: { value: -937826, label: "Vendas" },
    CL82: { value: -410074, label: "G&A" },
    CL89: { value: -309848, label: "Depreciação" },
    CL94: { value: -254536, label: "PDD líq" },
    CL99: { value: -176631, label: "Produtos/serviços financeiros" },
    CL108: { value: -73718, label: "Participação empregados" },
    CL111: { value: 10017, label: "Outras" },
    CL114: { value: -99073, label: "Result on Sales/Write-off/Impair" },
    CL117: { value: -4608, label: "Stock Options" },
    CL120: { value: -12675, label: "Statutory Participation" },
    CL189: { value: -129512, label: "Depreciation for Leasing (IFRS16)" },
    CL190: { value: -61048, label: "Financial Exp for Leasing (IFRS16)" },
    CL192: { value: 12399, label: "Other adjustments" },
    CL205: { value: 874492, label: "EBITDA RETAIL Adj (ex IFRS)", tolerance: 2000 },
  },

  projDuplicatePairs: [
    { sheet: "PROJ", a: "r94", b: "r99", label: "Recoverable Taxes (current vs LT)" },
    // LREN3 has no loans at all in 4Q25 — both rows legitimately 0.
    // Any other company/quarter where this pair collapses to 0 should
    // still fail; only LREN3 4Q25 gets the explicit accept.
    { sheet: "PROJ", a: "r111", b: "r120", label: "Loans, Financing and Debentures (current vs LT)", acceptZero: true },
    { sheet: "PROJ", a: "r112", b: "r122", label: "Financing Lease (current vs LT)" },
    { sheet: "PROJ", a: "r113", b: "r121", label: "Financing - Financial Products (current vs LT)" },
    { sheet: "PROJ", a: "r118", b: "r125", label: "Other Current Liabilities (current vs LT)" },
  ],

  acceptedValidationWarnings: [
    /Loans, Financing and Debentures.*0\.000000/,
  ],
};
