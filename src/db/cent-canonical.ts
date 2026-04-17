export const CENT_NAME = "Grupo SBF / Centauro";
export const CENT_TICKER = "CENT";
export const CENT_TEMPLATE_PATH = "data/CENT 4Q25.xlsx";
export const CENT_EXPECTED_MAPPING_COUNT = 35;

export interface CentMappingDefinition {
  colMode: "quarterly_offset";
  sourceSection: string;
  sourceCol: string;
  sourceLabel: string;
  targetSheet: "PROJ";
  targetRow: number;
  targetColBase: "C";
  targetColStep: 1;
  baseQuarter: "4Q09";
  expectedCurrency: "BRL";
  valueTransform: null;
  validationSign: "positive" | "negative" | null;
}

const PROJ = "PROJ" as const;
const C = "C" as const;
const ONE = 1 as const;
const BASE_QUARTER = "4Q09" as const;
const BRL = "BRL" as const;

function makeMapping(
  sourceSection: string,
  sourceCol: string,
  sourceLabel: string,
  targetRow: number,
  validationSign: CentMappingDefinition["validationSign"] = null,
): CentMappingDefinition {
  return {
    colMode: "quarterly_offset",
    sourceSection,
    sourceCol,
    sourceLabel,
    targetSheet: PROJ,
    targetRow,
    targetColBase: C,
    targetColStep: ONE,
    baseQuarter: BASE_QUARTER,
    expectedCurrency: BRL,
    valueTransform: null,
    validationSign,
  };
}

export const CENT_CANONICAL_MAPPINGS: readonly CentMappingDefinition[] = [
  // Income Statement
  makeMapping("DRE I IncomeStatement", "4Q25", "Gross revenue", 3, "positive"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Net revenue", 5, "positive"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Cost of sales", 8, "negative"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Gross profit", 9, "positive"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Selling expenses (w/o depreciation) (ex-IFRS16)", 14, "negative"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Administrative and general expenses (w/o depreciation) (ex-IFRS16)", 15, "negative"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Depreciation and Amortization", 16, "negative"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Other operating income, net (ex-IFRS16)", 18, null),
  makeMapping("DRE I IncomeStatement", "4Q25", "Income before financial result (ex-IFRS16)", 19, null),
  makeMapping("DRE I IncomeStatement", "4Q25", "Financial result (ex-IFRS16)", 20, null),
  makeMapping("DRE I IncomeStatement", "4Q25", "Financial Income (Expenses), net", 21, null),
  makeMapping("DRE I IncomeStatement", "4Q25", "Finance costs (ex-IFRS16)", 22, "negative"),
  makeMapping("DRE I IncomeStatement", "4Q25", "Income before income taxes (ex-IFRS16)", 27, null),
  makeMapping("DRE I IncomeStatement", "4Q25", "Income tax and social contribution (ex-IFRS16)", 28, null),
  makeMapping("DRE I IncomeStatement", "4Q25", "Net income for period (ex-IFRS16)", 32, null),

  // Balance Sheet
  makeMapping("BP |  BalanceSheet", "2025", "Cash and cash equivalents", 91, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Contas a receber", 92, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Inventory", 93, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Recoverable taxes", 94, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Non-current assets", 96, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Deferred income and social contribution", 99, null),
  makeMapping("BP |  BalanceSheet", "2025", "Long-term receivables", 100, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Investments", 102, null),
  makeMapping("BP |  BalanceSheet", "2025", "Property and equipment", 103, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Intangible", 104, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Total assets", 106, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Current liabilities", 107, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Suppliers", 108, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Tax liabilities", 111, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Tax installment payment", 112, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Dividends payable", 113, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Tax installment", 119, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Provisions", 120, "positive"),
  makeMapping("BP |  BalanceSheet", "2025", "Shareholders' equity", 124, null),
  makeMapping("BP |  BalanceSheet", "2025", "Total liabilities and shareholders' equity", 126, "positive"),
] as const;

export function buildCentMappingValues(companyId: number) {
  return CENT_CANONICAL_MAPPINGS.map((mapping) => ({
    companyId,
    ...mapping,
  }));
}
