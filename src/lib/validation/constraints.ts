/**
 * Arithmetic constraints for adversarial validation.
 * Defines relationships between extracted values that must hold true.
 */

export interface ConstraintTerm {
  /** Pipe-separated label alternatives (e.g., "Revenue|Ingresos|Receita") */
  labels: string;
  /** Coefficient: 1 for addends, -1 for subtractands */
  coefficient: number;
}

export interface ArithmeticConstraint {
  name: string;
  description: string;
  /** Terms that participate in this constraint */
  terms: ConstraintTerm[];
  /** Label alternatives for the result (pipe-separated) */
  resultLabel: string;
  /** Tolerance for floating point comparison (absolute, in source units) */
  tolerance: number;
}

/**
 * Income Statement constraints.
 * These are universal across companies using standard IFRS/GAAP.
 */
export const INCOME_STATEMENT_CONSTRAINTS: ArithmeticConstraint[] = [
  {
    name: "gross_profit",
    description: "Gross Profit = Revenue - Cost of Sales",
    terms: [
      { labels: "Revenue|Ingresos|Receita|Net Revenue|Receita Líquida", coefficient: 1 },
      { labels: "Cost of Sales|Costo de Ventas|Custo|COGS", coefficient: -1 },
    ],
    resultLabel: "Gross Profit|Utilidad Bruta|Lucro Bruto",
    tolerance: 1,
  },
  {
    name: "operating_income",
    description: "Operating Income = Gross Profit - Operating Expenses",
    terms: [
      { labels: "Gross Profit|Utilidad Bruta|Lucro Bruto", coefficient: 1 },
      { labels: "Operating Expenses|Gastos de Operación|SG&A|Gastos Operativos", coefficient: -1 },
    ],
    resultLabel: "Operating Income|EBIT|Utilidad de Operación|Lucro Operacional",
    tolerance: 1,
  },
  {
    name: "net_income",
    description: "Net Income = Operating Income - Interest - Tax",
    terms: [
      { labels: "Operating Income|EBIT|Utilidad de Operación|Lucro Operacional", coefficient: 1 },
      { labels: "Interest Expense|Gastos Financieros|Despesas Financeiras", coefficient: -1 },
      { labels: "Income Tax|Impuestos|Impostos", coefficient: -1 },
    ],
    resultLabel: "Net Income|Utilidad Neta|Lucro Líquido",
    tolerance: 1,
  },
];

/**
 * Balance Sheet constraints (Assets = Liabilities + Equity).
 */
export const BALANCE_SHEET_CONSTRAINTS: ArithmeticConstraint[] = [
  {
    name: "balance_equation",
    description: "Total Assets = Total Liabilities + Total Equity",
    terms: [
      { labels: "Total Liabilities|Pasivo Total|Passivo Total", coefficient: 1 },
      { labels: "Total Equity|Capital Contable|Patrimônio|Patrimonio Neto", coefficient: 1 },
    ],
    resultLabel: "Total Assets|Activo Total|Ativo Total",
    tolerance: 1,
  },
  {
    name: "current_assets",
    description: "Total Assets = Current + Non-Current",
    terms: [
      { labels: "Current Assets|Activo Circulante|Ativo Circulante", coefficient: 1 },
      { labels: "Non-Current Assets|Activo No Circulante|Ativo Não Circulante", coefficient: 1 },
    ],
    resultLabel: "Total Assets|Activo Total|Ativo Total",
    tolerance: 1,
  },
];

/**
 * Get all constraints for a given statement type.
 */
export function getConstraintsForStatement(
  statementType: "income" | "balance" | "cashflow"
): ArithmeticConstraint[] {
  switch (statementType) {
    case "income":
      return INCOME_STATEMENT_CONSTRAINTS;
    case "balance":
      return BALANCE_SHEET_CONSTRAINTS;
    case "cashflow":
      return []; // TODO: Add cash flow constraints
    default:
      return [];
  }
}

/**
 * Check if a label matches a pattern (supports pipe-separated alternatives).
 */
export function labelMatches(label: string, pattern: string): boolean {
  const alternatives = pattern.split("|");
  const normalizedLabel = label.toLowerCase().trim();
  return alternatives.some(alt =>
    normalizedLabel.includes(alt.toLowerCase().trim())
  );
}
