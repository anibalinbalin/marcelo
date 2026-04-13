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
  'ingresos netos': 'net revenue',
  'costo de ventas': 'cost of sales',
  'utilidad bruta': 'gross profit',
  'utilidad neta': 'net income',
  'efectivo y equivalentes': 'cash and equivalents',
  'activo total': 'total assets',
  'capital contable': 'stockholders equity',
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
