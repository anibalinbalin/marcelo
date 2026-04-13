import { describe, it, expect } from 'vitest';
import { matchLabelToConcept, normalizeLabel } from '../concept-matcher';
import { CANONICAL_CONCEPTS } from '../../../db/canonical-concepts';

describe('normalizeLabel', () => {
  it('strips accents, lowercases, and collapses whitespace', () => {
    expect(normalizeLabel('  Receita   Líquida ')).toBe('receita liquida');
  });

  it('removes parenthetical notes', () => {
    expect(normalizeLabel('Net Income (attributable to shareholders)')).toBe('net income');
  });

  it('collapses punctuation', () => {
    expect(normalizeLabel('Cost of Sales, Net')).toBe('cost of sales net');
  });
});

describe('matchLabelToConcept', () => {
  it('returns exact match ignoring case and accents', () => {
    const hit = matchLabelToConcept('NET REVENUE', CANONICAL_CONCEPTS);
    expect(hit?.name).toBe('Net Revenue');
  });

  it('matches a Portuguese alias via the alias dictionary', () => {
    const hit = matchLabelToConcept('Receita Líquida', CANONICAL_CONCEPTS);
    expect(hit?.name).toBe('Net Revenue');
  });

  it('returns null when no confident match exists', () => {
    const hit = matchLabelToConcept('Totally Unknown Line', CANONICAL_CONCEPTS);
    expect(hit).toBeNull();
  });

  it('disambiguates current vs noncurrent recoverable taxes by keyword', () => {
    const current = matchLabelToConcept('Recoverable Taxes (current)', CANONICAL_CONCEPTS);
    const noncurrent = matchLabelToConcept('Recoverable Taxes (noncurrent)', CANONICAL_CONCEPTS);
    expect(current?.name).toBe('Recoverable Taxes Current');
    expect(noncurrent?.name).toBe('Recoverable Taxes Noncurrent');
  });

  it('matches a Portuguese label whose translated target contains punctuation', () => {
    const hit = matchLabelToConcept('Resultado de Participações', CANONICAL_CONCEPTS);
    expect(hit?.name).toBe('Equity Pick-ups');
  });
});
