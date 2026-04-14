/**
 * Arithmetic constraints for adversarial validation.
 * Defines relationships between extracted values that must hold true.
 */

/**
 * Sign discipline for a term. Encodes the accounting flow, not the
 * extraction storage convention, so a constraint works regardless of
 * whether the source stores costs as positive magnitudes or as negative
 * signed numbers.
 *
 * - "inflow"  → always contributes +|value| (e.g., revenue, cash inflow)
 * - "outflow" → always contributes -|value| (e.g., cost of sales, tax)
 * - "signed"  → contributes the extracted value as-is (for items that can
 *               be naturally positive or negative, e.g., investing CF,
 *               "other operating income, net")
 */
export type TermFlow = "inflow" | "outflow" | "signed";

export interface ConstraintTerm {
  /** Pipe-separated label alternatives (e.g., "Revenue|Ingresos|Receita") */
  labels: string;
  /** Sign discipline for this term. */
  flow: TermFlow;
}

export interface ArithmeticConstraint {
  name: string;
  description: string;
  /** Terms that participate in this constraint */
  terms: ConstraintTerm[];
  /** Label alternatives for the result (pipe-separated) */
  resultLabel: string;
  /**
   * Allowed divergence as a fraction of max(|sum|, |result|). For example,
   * 0.01 allows a 1% discrepancy. Absolute floor is MIN_TOLERANCE_ABSOLUTE
   * so near-zero values don't trip on floating-point noise.
   *
   * Why fraction, not absolute: IS layouts with many expense lines (CENT
   * has 5+) produce a ~0.5-1% gap between sum-of-expenses and
   * operating_income due to categories we don't enumerate. Absolute=1 was
   * false-positiving at a 25% rate on clean runs — see
   * docs/eval-baseline-2026-04-13.md.
   */
  toleranceFraction: number;
}

/** Floor tolerance for values close to zero, so 0.0 ± floating-point noise
 * doesn't trigger a violation. In source units (e.g., thousands or millions
 * depending on company normalization). */
export const MIN_TOLERANCE_ABSOLUTE = 1;

/**
 * Income Statement constraints.
 * These are universal across companies using standard IFRS/GAAP.
 *
 * Label expansion notes (2026-04-14):
 * - Added ENEL's Spanish labels so the existing three constraints fire on
 *   utility-style statements: "Costo de actividades ordinarias" (cost of
 *   sales), "Margen de contribución" (gross profit), "Gastos de
 *   administración" (opex), "Resultado operacional" (operating income).
 * - Kept each pattern ordering so more-specific labels win prefix matching.
 */
export const INCOME_STATEMENT_CONSTRAINTS: ArithmeticConstraint[] = [
  {
    name: "gross_profit",
    description: "Gross Profit = Net Revenue - Cost of Sales",
    terms: [
      // Put "Net Revenue" before "Revenue" so label matching prefers the
      // specific line when both exist (CENT has both Gross revenue and
      // Net revenue; only Net revenue - COGS equals Gross profit).
      //
      // Bare "Ingresos" is intentionally excluded — prefix matching made
      // it collide with "Ingresos por intereses" (BANREGIO bank line) and
      // "Ingresos financieros" (ENEL financial income). Use the qualified
      // "Ingresos de actividades ordinarias" form instead.
      { labels: "Net Revenue|Receita Líquida|Revenue|Ingresos de Actividades Ordinarias|Ingresos de Operación|Receita", flow: "inflow" },
      { labels: "Cost of Sales|Costo de Ventas|Costo de Actividades Ordinarias|Custo|COGS", flow: "outflow" },
    ],
    resultLabel: "Gross Profit|Utilidad Bruta|Margen de Contribución|Lucro Bruto",
    toleranceFraction: 0.01,
  },
  {
    name: "operating_income",
    description: "Operating Income = Gross Profit - Operating Expenses",
    terms: [
      { labels: "Gross Profit|Utilidad Bruta|Margen de Contribución|Lucro Bruto", flow: "inflow" },
      { labels: "Operating Expenses|Gastos de Operación|Gastos de Administración|SG&A|Gastos Operativos", flow: "outflow" },
    ],
    resultLabel: "Operating Income|EBIT|Utilidad de Operación|Resultado Operacional|Lucro Operacional",
    toleranceFraction: 0.01,
  },
  {
    name: "net_income",
    description: "Net Income = Operating Income - Interest - Tax",
    terms: [
      { labels: "Operating Income|EBIT|Utilidad de Operación|Resultado Operacional|Lucro Operacional", flow: "inflow" },
      { labels: "Interest Expense|Gastos Financieros|Despesas Financeiras", flow: "outflow" },
      { labels: "Income Tax|Impuestos|Impostos", flow: "outflow" },
    ],
    resultLabel: "Net Income|Utilidad Neta|Lucro Líquido|Ganancia del Periodo",
    toleranceFraction: 0.01,
  },
];

/**
 * Banking Income Statement constraints.
 *
 * Banks don't have Revenue - COGS = Gross Profit. Their waterfall is built
 * on interest margin and loan provisions. These constraints are additive
 * with INCOME_STATEMENT_CONSTRAINTS — the standard checker iterates all
 * active constraints and only fires where the terms match.
 *
 * Why NIM-only (2026-04-14):
 *
 * BANREGIO's current mapping set captures main waterfall lines but NOT
 * intermediate bank-specific items like fee income, trading gains,
 * "Otros productos, neto", and subsidiary minority interest. The NIM
 * equation (Margen financiero = Ingresos por intereses − Gastos por
 * intereses) balances exactly. But the downstream two we originally
 * tried to enforce (`bank_operating_income` and `bank_net_income`)
 * produced 960 and 38 unit gaps respectively on BANREGIO clean data,
 * which tripped false-positive violations on every run. Those are
 * removed until the mapping set covers the missing intermediate lines.
 *
 * The NIM constraint alone is enough to catch any corruption on
 * Ingresos por intereses, Gastos por intereses, or Margen financiero.
 * The victim picker targets those rows first because their labels
 * match the NIM term patterns, so 5-of-5 non-clean corruptions are
 * caught on the eval corpus. Adding the downstream constraints back
 * (with correct "other" term coverage) is a follow-up.
 *
 * BANREGIO-specific labels (Spanish, Mexican banking convention):
 * - Ingresos por intereses → interest income
 * - Gastos por intereses → interest expense
 * - Margen financiero → net interest margin (NIM)
 */
export const BANKING_INCOME_CONSTRAINTS: ArithmeticConstraint[] = [
  {
    name: "net_interest_margin",
    description: "Net Interest Margin = Interest Income - Interest Expense",
    terms: [
      { labels: "Ingresos por Intereses|Interest Income|Net Interest Income|Intereses Ganados", flow: "inflow" },
      { labels: "Gastos por Intereses|Interest Expense|Intereses Pagados", flow: "outflow" },
    ],
    resultLabel: "Margen Financiero|Net Interest Margin|NIM|Margen de Interés Neto",
    toleranceFraction: 0.01,
  },
];

/**
 * Cash Flow Statement constraints.
 * The universal identity: Net change in cash = Operating + Investing + Financing.
 * FX effect on cash is sometimes a separate line; the existing checker ignores
 * constraints where fewer than 2 terms match, so companies that don't report a
 * standalone FX line are still covered.
 */
export const CASHFLOW_CONSTRAINTS: ArithmeticConstraint[] = [
  {
    name: "net_change_in_cash",
    description: "Net Change in Cash = Operating CF + Investing CF + Financing CF",
    terms: [
      { labels: "Operating Activities|Actividades de Operación|Atividades Operacionais|Cash from Operations|Flujo de Operación|Cash Flow from Operating", flow: "signed" },
      { labels: "Investing Activities|Actividades de Inversión|Atividades de Investimento|Cash from Investing|Flujo de Inversión", flow: "signed" },
      { labels: "Financing Activities|Actividades de Financiamiento|Atividades de Financiamento|Cash from Financing|Flujo de Financiamiento", flow: "signed" },
    ],
    resultLabel: "Net Change in Cash|Variación Neta de Efectivo|Variação do Caixa|Net Increase in Cash|Aumento Neto en Efectivo",
    toleranceFraction: 0.01,
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
      { labels: "Total Liabilities|Pasivo Total|Passivo Total", flow: "signed" },
      { labels: "Total Equity|Capital Contable|Patrimônio|Patrimonio Neto", flow: "signed" },
    ],
    resultLabel: "Total Assets|Activo Total|Ativo Total",
    toleranceFraction: 0.01,
  },
  {
    name: "current_assets",
    description: "Total Assets = Current + Non-Current",
    terms: [
      { labels: "Current Assets|Activo Circulante|Ativo Circulante", flow: "signed" },
      { labels: "Non-Current Assets|Activo No Circulante|Ativo Não Circulante", flow: "signed" },
    ],
    resultLabel: "Total Assets|Activo Total|Ativo Total",
    toleranceFraction: 0.01,
  },
];

/**
 * Get all constraints for a given statement type.
 *
 * For income statements, both standard and banking constraints are returned.
 * The checker's `termsFound < 2` guard silently skips constraints whose
 * terms don't exist in the run, so companies with standard IS layouts won't
 * trip on banking labels and vice versa. No per-company routing required.
 */
export function getConstraintsForStatement(
  statementType: "income" | "balance" | "cashflow"
): ArithmeticConstraint[] {
  switch (statementType) {
    case "income":
      return [...INCOME_STATEMENT_CONSTRAINTS, ...BANKING_INCOME_CONSTRAINTS];
    case "balance":
      return BALANCE_SHEET_CONSTRAINTS;
    case "cashflow":
      return CASHFLOW_CONSTRAINTS;
    default:
      return [];
  }
}

/**
 * Check if a label matches a pattern (pipe-separated alternatives).
 *
 * Uses prefix matching, not substring matching. Before W1.7 this was
 * `normalizedLabel.includes(alt)`, which produced three distinct false
 * positives on CENT:
 *
 * - "Other operating income, net" matched the Operating Income alternative
 *   (substring: "other **operating income**, net")
 * - "Income before income taxes" matched the Income Tax alternative
 *   (substring: "income before **income tax**es")
 * - "Gross revenue" matched the Revenue alternative before "Net revenue"
 *   did, and only Net revenue - COGS equals gross profit
 *
 * Prefix matching fixes all three: a label matches an alternative only
 * when the normalized label starts with the alternative. Pluralization
 * still works ("revenues" starts with "revenue"), and punctuation or
 * suffixes like "(ex-IFRS16)" are naturally ignored.
 *
 * Ordering of alternatives matters: the first matching alternative wins,
 * so constraint authors should put the more specific alternative first
 * (e.g., "Net Revenue" before "Revenue").
 */
export function labelMatches(label: string, pattern: string): boolean {
  const alternatives = pattern.split("|");
  const normalizedLabel = label.toLowerCase().trim();
  return alternatives.some(alt =>
    normalizedLabel.startsWith(alt.toLowerCase().trim())
  );
}
