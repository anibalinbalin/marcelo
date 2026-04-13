import type { CanonicalConceptSeed } from '../../db/canonical-concepts';

const PT_TO_EN: Record<string, string> = {
  'receita liquida': 'net revenue',
  'receita bruta': 'gross revenue',
  'custo dos produtos vendidos': 'cost of sales',
  'custo das mercadorias vendidas': 'cost of sales',
  'lucro bruto': 'gross profit',
  'despesas com vendas': 'selling expenses',
  'despesas gerais e administrativas': 'general and administrative expenses',
  'ebitda': 'ebitda',
  'depreciacao e amortizacao': 'depreciation and amortization',
  'resultado financeiro liquido': 'net financial result',
  'resultado de participacoes': 'equity pick-ups',
  'lucro antes do imposto': 'income before taxes',
  'imposto de renda e contribuicao social': 'income tax and social contribution',
  'lucro liquido': 'net income',
  'caixa e equivalentes': 'cash and equivalents',
  'contas a receber': 'accounts receivable',
  'estoques': 'inventories',
  'imobilizado': 'property plant and equipment',
  'direito de uso': 'right of use assets',
  'intangivel': 'intangible assets',
  'ativo total': 'total assets',
  'fornecedores': 'suppliers',
  'patrimonio liquido': 'stockholders equity',
};

const ES_TO_EN: Record<string, string> = {
  // Income statement
  'ingresos': 'net revenue',
  'ingresos netos': 'net revenue',
  'ingresos de actividades ordinarias': 'net revenue',
  'costo de ventas': 'cost of sales',
  'costo de actividades ordinarias': 'cost of sales',
  'utilidad bruta': 'gross profit',
  'gastos de venta': 'selling expenses',
  'gastos de administracion': 'general and administrative expenses',
  'gastos de operacion': 'general and administrative expenses',
  'utilidad de operacion': 'operating income',
  'resultado operacional': 'operating income',
  'resultado de la operacion': 'operating income',
  'margen financiero': 'net financial result',
  'margen de contribucion': 'gross profit',
  'ingresos financieros': 'financial income',
  'ingresos por intereses': 'financial income',
  'gastos financieros': 'financial expenses',
  'costos financieros': 'financial expenses',
  'gastos por intereses': 'financial expenses',
  'utilidad antes de impuestos': 'income before taxes',
  'impuestos a la utilidad': 'income tax and social contribution',
  'ingreso por impuestos a las ganancias': 'income tax and social contribution',
  'gasto por impuestos a las ganancias': 'income tax and social contribution',
  'i s r y p t u causados': 'income tax and social contribution',
  'utilidad neta': 'net income',
  'ganancia del periodo': 'net income',
  'resultado neto': 'net income',
  'utilidad atribuible a la participacion no controladora': 'minority interest',
  'ganancia atribuible a participaciones no controladoras': 'minority interest',
  'participaciones no controladoras': 'minority interest',
  'participacion en la utilidad de asociadas y negocios conjuntos': 'equity pick-ups',
  'otros ingresos': 'other operating income',
  'otras ganancias': 'other operating income',
  // Balance sheet
  'efectivo y equivalentes': 'cash and equivalents',
  'efectivo y equivalentes de efectivo': 'cash and equivalents',
  'efectivo y equivalentes al efectivo': 'cash and equivalents',
  'clientes y otras cuentas por cobrar': 'accounts receivable',
  'inventarios': 'inventories',
  'propiedades planta y equipo': 'property plant and equipment',
  'activo total': 'total assets',
  'total de activos': 'total assets',
  'total activo': 'total assets',
  'total de activos circulantes': 'total current assets',
  'total de activos corrientes': 'total current assets',
  'total de activos no circulantes': 'total noncurrent assets',
  'total de pasivos circulantes': 'total current liabilities',
  'total de pasivos corrientes': 'total current liabilities',
  'total de pasivos a largo plazo': 'total noncurrent liabilities',
  'total pasivos': 'total liabilities',
  'total pasivo': 'total liabilities',
  'capital contable': 'stockholders equity',
  'total de capital contable': 'stockholders equity',
  'total capital contable': 'stockholders equity',
  'total de patrimonio': 'stockholders equity',
  'total de la participacion controladora': 'stockholders equity',
  'proveedores y otras cuentas por pagar a corto plazo': 'suppliers',
  'otros pasivos financieros a corto plazo': 'loans and financing current',
  'otros pasivos financieros a largo plazo': 'loans and financing noncurrent',
  'pasivos por arrendamiento': 'lease liabilities current',
};

// Variant / informal / abbreviated English phrasings mapped to canonical concepts.
const EN_ALIAS: Record<string, string> = {
  // Income statement
  'gross revenues': 'gross revenue',
  'gross operating revenues': 'gross revenue',
  'cogs': 'cost of sales',
  'costs of goods sold': 'cost of sales',
  'selling': 'selling expenses',
  'g a expenses': 'general and administrative expenses',
  'general and administrative': 'general and administrative expenses',
  'administrative and general expenses': 'general and administrative expenses',
  'administrative and general expenses w o depreciation': 'general and administrative expenses',
  'selling expenses w o depreciation': 'selling expenses',
  'd a': 'depreciation and amortization',
  'net financials': 'net financial result',
  'financial result': 'net financial result',
  'financial income net': 'net financial result',
  'finance costs': 'financial expenses',
  'interest expenses': 'financial expenses',
  'interest revenues': 'financial income',
  'income before financial result': 'operating income',
  'income before income taxes': 'income before taxes',
  'income and social contribution taxes': 'income tax and social contribution',
  'tax expenses': 'income tax and social contribution',
  'net income for period': 'net income',
  'other operating income net': 'other operating income',
  'losses on receivables net': 'losses on receivables',
  // Balance sheet
  'cash and cash equivalents': 'cash and equivalents',
  'cash cash equivalents': 'cash and equivalents',
  'short term investments': 'short-term investments',
  'trade accounts receivable': 'accounts receivable',
  'inventory': 'inventories',
  'property and equipment': 'property plant and equipment',
  'right of use': 'right of use assets',
  'intangible': 'intangible assets',
  'shareholders equity': 'stockholders equity',
  'shareholder s equity': 'stockholders equity',
  'total liabilities and shareholders equity': 'total liabilities and equity',
  'liabilities and shareholder s equity': 'total liabilities and equity',
  'liabilities and shareholders equity': 'total liabilities and equity',
  'deferred income tax and social contribution': 'deferred income tax noncurrent',
  'loans financing and debentures': 'loans and financing current',
  'financing lease': 'lease liabilities current',
  'current liabilities': 'total current liabilities',
  'non current assets': 'total noncurrent assets',
  'long term receivables': 'other noncurrent assets',
  'tax liabilities': 'other current liabilities',
  'tax installment': 'other current liabilities',
  'tax installment payment': 'other noncurrent liabilities',
  'dividends payable': 'other current liabilities',
  'provisions': 'other current liabilities',
  'taxes obligations': 'other current liabilities',
  'social and labor obligations': 'other current liabilities',
};

export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')     // strip diacritics
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')          // drop parentheticals
    .replace(/[^a-z0-9\s]/g, ' ')        // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
}

function translate(label: string): string {
  if (PT_TO_EN[label]) return PT_TO_EN[label];
  if (ES_TO_EN[label]) return ES_TO_EN[label];
  if (EN_ALIAS[label]) return EN_ALIAS[label];
  return label;
}

export function matchLabelToConcept(
  rawLabel: string,
  concepts: readonly CanonicalConceptSeed[],
): CanonicalConceptSeed | null {
  // normalizedRaw preserves parenthetical content for disambiguation
  const normalizedRaw = rawLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = normalizeLabel(translate(normalizeLabel(rawLabel)));

  // Exact normalized match on concept name
  for (const c of concepts) {
    if (normalizeLabel(c.name) === normalized) return c;
  }

  // Disambiguation: "recoverable taxes" + current/noncurrent keyword
  // Check normalizedRaw for the keyword so parenthetical hints like "(noncurrent)" are still visible
  if (normalized.includes('recoverable taxes')) {
    const isNoncurrent = /\b(noncurrent|non.?current|long.?term|longo prazo)\b/.test(normalizedRaw);
    const targetName = isNoncurrent ? 'Recoverable Taxes Noncurrent' : 'Recoverable Taxes Current';
    return concepts.find((c) => c.name === targetName) ?? null;
  }

  // Prefix / suffix contains match — all-words-present
  const words = normalized.split(' ').filter(Boolean);
  for (const c of concepts) {
    const cn = normalizeLabel(c.name);
    if (words.length > 1 && words.every((w) => cn.includes(w))) return c;
  }

  return null;
}
