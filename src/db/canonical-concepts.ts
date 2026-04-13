/**
 * Canonical financial concepts. The semantic layer of the Extraction Memory
 * System — every concept here is the "one true" identifier for a line item
 * across every company, regardless of language or label wording.
 *
 * Importable without a DB connection so it can be unit-tested and reused by
 * the matcher and the seed script.
 */

export type ConceptCategory = 'income_statement' | 'balance_sheet' | 'cash_flow';
export type TypicalSign = 'positive' | 'negative' | 'either';

export type CanonicalConceptSeed = {
  name: string;
  category: ConceptCategory;
  typicalSign: TypicalSign;
  description?: string;
};

export const CANONICAL_CONCEPTS: CanonicalConceptSeed[] = [
  // ─── Income Statement ─────────────────────────────────────────────────────
  { name: 'Net Revenue', category: 'income_statement', typicalSign: 'positive', description: 'Top-line revenue, net of discounts and returns' },
  { name: 'Gross Revenue', category: 'income_statement', typicalSign: 'positive' },
  { name: 'Cost of Sales', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Gross Profit', category: 'income_statement', typicalSign: 'positive' },
  { name: 'Selling Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'General and Administrative Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Other Operating Income', category: 'income_statement', typicalSign: 'either' },
  { name: 'Other Operating Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Operating Income', category: 'income_statement', typicalSign: 'either', description: 'EBIT' },
  { name: 'EBITDA', category: 'income_statement', typicalSign: 'either' },
  { name: 'Depreciation and Amortization', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Financial Income', category: 'income_statement', typicalSign: 'positive' },
  { name: 'Financial Expenses', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Net Financial Result', category: 'income_statement', typicalSign: 'either' },
  { name: 'Equity Pick-ups', category: 'income_statement', typicalSign: 'either' },
  { name: 'Income Before Taxes', category: 'income_statement', typicalSign: 'either' },
  { name: 'Income Tax and Social Contribution', category: 'income_statement', typicalSign: 'negative' },
  { name: 'Net Income', category: 'income_statement', typicalSign: 'either' },
  { name: 'Minority Interest', category: 'income_statement', typicalSign: 'either' },
  { name: 'Losses on Receivables', category: 'income_statement', typicalSign: 'negative' },

  // ─── Balance Sheet — Assets ───────────────────────────────────────────────
  { name: 'Cash and Equivalents', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Short-term Investments', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Accounts Receivable', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Inventories', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Recoverable Taxes Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Other Current Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Current Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Recoverable Taxes Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Deferred Taxes', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Investments', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Property Plant and Equipment', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Right of Use Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Intangible Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Noncurrent Assets', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Assets', category: 'balance_sheet', typicalSign: 'positive' },

  // ─── Balance Sheet — Liabilities & Equity ─────────────────────────────────
  { name: 'Suppliers', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Loans and Financing Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Lease Liabilities Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Other Accounts Payable Current', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Current Liabilities', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Loans and Financing Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Lease Liabilities Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Deferred Income Tax Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Other Accounts Payable Noncurrent', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Noncurrent Liabilities', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Stockholders Equity', category: 'balance_sheet', typicalSign: 'positive' },
  { name: 'Total Liabilities and Equity', category: 'balance_sheet', typicalSign: 'positive' },

  // ─── Cash Flow ────────────────────────────────────────────────────────────
  { name: 'Cash From Operations', category: 'cash_flow', typicalSign: 'either' },
  { name: 'Capital Expenditures', category: 'cash_flow', typicalSign: 'negative' },
  { name: 'Cash From Investing', category: 'cash_flow', typicalSign: 'either' },
  { name: 'Cash From Financing', category: 'cash_flow', typicalSign: 'either' },
  { name: 'Net Change in Cash', category: 'cash_flow', typicalSign: 'either' },
];
