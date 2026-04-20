export const LREN3_NAME = "Lojas Renner";
export const LREN3_TICKER = "LREN3";
export const LREN3_TEMPLATE_PATH = "public/camila/LREN3 OK.xlsx";
export const LREN3_EXPECTED_MAPPING_COUNT = 77;

export interface Lren3MappingDefinition {
  colMode: "quarterly_offset";
  sourceSection: string;
  sourceLabel: string;
  sourceRow: number | null;
  sourceCol: "4Q25";
  targetSheet: "PROJ" | "FAT";
  targetRow: number;
  targetColBase: "C";
  targetColStep: 1;
  baseQuarter: "1Q04";
  expectedCurrency: "BRL";
  valueTransform: null;
  validationSign: "positive" | "negative" | null;
}

const PROJ = "PROJ" as const;
const FAT = "FAT" as const;
const Q4_25 = "4Q25" as const;
const C = "C" as const;
const ONE = 1 as const;
const BASE_QUARTER = "1Q04" as const;
const BRL = "BRL" as const;

function makeMapping(
  targetSheet: Lren3MappingDefinition["targetSheet"],
  targetRow: number,
  sourceSection: string,
  sourceLabel: string,
  validationSign: Lren3MappingDefinition["validationSign"],
  sourceRow: number | null = null,
): Lren3MappingDefinition {
  return {
    colMode: "quarterly_offset",
    sourceSection,
    sourceLabel,
    sourceRow,
    sourceCol: Q4_25,
    targetSheet,
    targetRow,
    targetColBase: C,
    targetColStep: ONE,
    baseQuarter: BASE_QUARTER,
    expectedCurrency: BRL,
    valueTransform: null,
    validationSign,
  };
}

export const LREN3_PROJ_MAPPINGS: readonly Lren3MappingDefinition[] = [
  makeMapping(PROJ, 3, "Income Statement", "Gross Operating Revenues", "positive"),
  makeMapping(PROJ, 7, "Income Statement", "Costs of Goods Sold", "negative"),
  makeMapping(PROJ, 11, "Income Statement", "Selling", "negative"),
  makeMapping(PROJ, 12, "Income Statement", "General and Administrative", "negative"),
  makeMapping(PROJ, 13, "Income Statement", "Depreciation and Amortization", "negative"),
  makeMapping(PROJ, 14, "Income Statement", "Losses on Receivables, Net", "negative"),
  makeMapping(PROJ, 15, "Income Statement", "Other Operating Income", null),
  makeMapping(PROJ, 18, "Income Statement", "Financial Result", null, 53),
  makeMapping(PROJ, 23, "Income Statement", "Income and Social Contribution Taxes", "negative"),
  makeMapping(PROJ, 32, "Income Statement", "Equity Pick-ups", null),
  makeMapping(PROJ, 90, "Balance Sheet", "Cash & Cash Equivalents", "positive"),
  makeMapping(PROJ, 91, "Balance Sheet", "Short-Term Investments", "positive"),
  makeMapping(PROJ, 92, "Balance Sheet", "Trade Accounts Receivable", "positive"),
  makeMapping(PROJ, 93, "Balance Sheet", "Inventories", "positive"),
  makeMapping(PROJ, 94, "Balance Sheet", "Recoverable Taxes", "positive", 14),
  makeMapping(PROJ, 95, "Balance Sheet", "Other assets", "positive", 17),
  makeMapping(PROJ, 99, "Balance Sheet", "Recoverable Taxes", "positive", 21),
  makeMapping(PROJ, 100, "Balance Sheet", "Deferred Taxes", "positive", 23),
  makeMapping(PROJ, 101, "Balance Sheet", "Other assets", "positive", 24),
  makeMapping(PROJ, 103, "Balance Sheet", "Investments", "positive", 29),
  makeMapping(PROJ, 104, "Balance Sheet", "Property and Equipment", "positive", 30),
  makeMapping(PROJ, 105, "Balance Sheet", "Right of use", "positive", 31),
  makeMapping(PROJ, 106, "Balance Sheet", "Intangible", "positive", 32),
  makeMapping(PROJ, 109, "Balance Sheet", "Suppliers", "positive", 44),
  makeMapping(PROJ, 110, "Balance Sheet", "Obligations - Forfait", "positive", 45),
  makeMapping(PROJ, 111, "Balance Sheet", "Loans, Financing and Debentures", "positive", 40),
  makeMapping(PROJ, 112, "Balance Sheet", "Financing Lease", "positive", 42),
  makeMapping(PROJ, 113, "Balance Sheet", "Financing - Financial Products Operations", "positive", 41),
  makeMapping(PROJ, 114, "Balance Sheet", "Taxes obligations", "positive"),
  makeMapping(PROJ, 115, "Balance Sheet", "Social and labor obligations", "positive"),
  makeMapping(PROJ, 116, "Balance Sheet", "Liabilities Under Bylaws", "positive"),
  makeMapping(PROJ, 117, "Balance Sheet", "Obligations with Card Administrators", "positive", 46),
  makeMapping(PROJ, 118, "Balance Sheet", "Other Accounts Payable", "positive", 52),
  makeMapping(PROJ, 120, "Balance Sheet", "Loans, Financing and Debentures", "positive", 55),
  makeMapping(PROJ, 121, "Balance Sheet", "Financing - Financial Products Operations", "positive", 56),
  makeMapping(PROJ, 122, "Balance Sheet", "Financing Lease", "positive", 57),
  makeMapping(PROJ, 123, "Balance Sheet", "Deferred Income Tax and Social Contribution", "positive", 58),
  makeMapping(PROJ, 125, "Balance Sheet", "Other Accounts Payable", "positive", 63),
  makeMapping(PROJ, 126, "Balance Sheet", "Shareholder's Equity", "positive"),
  makeMapping(PROJ, 212, "Income Statement", "Equity Pick-ups", null),
] as const;

export const LREN3_FAT_MAPPINGS: readonly Lren3MappingDefinition[] = [
  makeMapping(FAT, 7, "Income Statement", "Vendas de Mercadorias, líquida de devoluções e cancelamentos", "positive"),
  makeMapping(FAT, 11, "Income Statement", "Receita Bruta de Serviços", "positive"),
  makeMapping(FAT, 30, "Income Statement", "Receita Líquida de Varejo", "positive"),
  makeMapping(FAT, 34, "Income Statement", "Receita Líquida de Serviços Financeiros", "positive"),
  makeMapping(FAT, 41, "Income Statement", "Costs of Retailing Operation", "negative"),
  makeMapping(FAT, 44, "Income Statement", "Costs of Financial Services", null),
  makeMapping(FAT, 73, "Income Statement", "Selling", "negative"),
  makeMapping(FAT, 82, "Income Statement", "General and Administrative", "negative"),
  makeMapping(FAT, 89, "Income Statement", "Depreciation and Amortization", "negative"),
  makeMapping(FAT, 94, "Income Statement", "Losses on Receivables, Net", "negative"),
  makeMapping(FAT, 99, "Income Statement", "Financial Services Expenses", "negative"),
  makeMapping(FAT, 108, "Income Statement", "Employee Profit Sharing Program", "negative"),
  makeMapping(FAT, 111, "Income Statement", "Other income and expenses", null),
  makeMapping(FAT, 114, "Income Statement", "Result on Sales, Write-off of or Impairment of Fixed Assets", null),
  makeMapping(FAT, 117, "Income Statement", "Stock Option Plan", "negative"),
  makeMapping(FAT, 120, "Income Statement", "Statutory Participation", "negative"),
  makeMapping(FAT, 189, "EBITDA", "Depreciationfor Leasing (IFRS16) (*)", "negative"),
  makeMapping(FAT, 190, "EBITDA", "Financial Expenses for Leasing (IFRS16) (**)", "negative"),
  makeMapping(FAT, 192, "EBITDA", "Other expenses", null),
  makeMapping(FAT, 205, "EBITDA", "Adjusted EBITDA from Retailing Operation (pre IFRS 16)", "positive"),
  makeMapping(FAT, 223, "Operating Data", "Quantity of stores - Renner", "positive", 30),
  makeMapping(FAT, 225, "Operating Data", "Average selling area of the period - Renner (thousand sq. meters)*", "positive", 33),
  makeMapping(FAT, 227, "Operating Data", "Retailing net revenues - Renner (R$ MM)", "positive", 34),
  makeMapping(FAT, 229, "Operating Data", "Gross margin - Renner (%)", "positive", 36),
  makeMapping(FAT, 235, "Operating Data", "Quantity of stores - Youcom", "positive", 52),
  makeMapping(FAT, 237, "Operating Data", "Average selling area of the period - Youcom (thousand sq. meters)*", "positive", 55),
  makeMapping(FAT, 239, "Operating Data", "Retailing net revenues - Youcom (R$ MM)", "positive", 56),
  makeMapping(FAT, 241, "Operating Data", "Gross margin - Youcom (%)", "positive", 58),
  makeMapping(FAT, 245, "Operating Data", "Quantity of stores - Camicado", "positive", 41),
  makeMapping(FAT, 247, "Operating Data", "Average selling area of the period - Camicado (thousand sq. meters)*", "positive", 44),
  makeMapping(FAT, 249, "Operating Data", "Retailing net revenues - Camicado (R$ MM)", "positive", 45),
  makeMapping(FAT, 251, "Operating Data", "Gross margin - Camicado (%)", "positive", 47),
  makeMapping(FAT, 300, "Income Statement", "Same Store Sales (%)", "positive", 11),
  makeMapping(FAT, 368, "CAPEX", "New stores", "positive", 8),
  makeMapping(FAT, 383, "CAPEX", "Remodelling of installations", "positive", 9),
  makeMapping(FAT, 394, "CAPEX", "IT equipament & systems", "positive", 10),
  makeMapping(FAT, 400, "CAPEX", "Logistics + Others Investments", "positive"),
] as const;

export const LREN3_CANONICAL_MAPPINGS: readonly Lren3MappingDefinition[] = [
  ...LREN3_PROJ_MAPPINGS,
  ...LREN3_FAT_MAPPINGS,
] as const;

export const LREN3_FAT_LITERAL_ROWS = [
  41, 44, 73, 82, 89, 94, 99, 108, 111, 114, 117, 120, 189, 190, 192, 205,
] as const;

export const LREN3_FAT_FORMULA_ROWS = [53] as const;

export const LREN3_PROJ_FORMULA_ROWS = [96, 102, 107, 108, 119, 128] as const;

export function buildLren3MappingValues(companyId: number) {
  return LREN3_CANONICAL_MAPPINGS.map((mapping) => ({
    companyId,
    ...mapping,
  }));
}
