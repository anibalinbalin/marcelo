// ---------------------------------------------------------------------------
// Quarter parsing and column-offset utilities
// ---------------------------------------------------------------------------

/** Convert a column letter (e.g. "A", "AQ") to a 1-based column number. */
function _colLetterToNumber(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64); // 'A' = 65
  }
  return n;
}

/** Convert a 1-based column number to a column letter (e.g. 1 → "A", 43 → "AQ"). */
function _colNumberToLetter(num: number): string {
  let s = "";
  while (num > 0) {
    num--; // adjust to 0-based
    s = String.fromCharCode((num % 26) + 65) + s;
    num = Math.floor(num / 26);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a quarter string like "4Q25" into its components.
 * Format is always `NQ` followed by a 2-digit year.
 */
export function parseQuarter(q: string): { quarter: number; year: number } {
  const match = q.match(/^(\d)Q(\d{2})$/);
  if (!match) throw new Error(`Invalid quarter format: "${q}"`);
  const quarter = Number(match[1]);
  const year = 2000 + Number(match[2]);
  return { quarter, year };
}

/**
 * Format a quarter number and full year back to the compact string.
 * (4, 2025) → "4Q25"
 */
export function formatQuarter(q: number, year: number): string {
  const yy = String(year).slice(-2).padStart(2, "0");
  return `${q}Q${yy}`;
}

/**
 * Calculate the number of quarters between `baseQ` and `targetQ`.
 * Example: quarterToColOffset("4Q25", "1Q15") → 43
 */
export function quarterToColOffset(targetQ: string, baseQ: string): number {
  const target = parseQuarter(targetQ);
  const base = parseQuarter(baseQ);
  return (target.year - base.year) * 4 + (target.quarter - base.quarter);
}

/**
 * Calculate the target column letter given a base column, a step size, and a
 * quarter offset (from `quarterToColOffset`).
 *
 * @param baseCol  Starting column letter (e.g. "B")
 * @param step     Number of spreadsheet columns per quarter (usually 1)
 * @param offset   Quarter offset from `quarterToColOffset`
 * @returns Column letter string (e.g. "AQ")
 */
export function getTargetCol(
  baseCol: string,
  step: number,
  offset: number,
): string {
  const baseNum = _colLetterToNumber(baseCol.toUpperCase());
  return _colNumberToLetter(baseNum + step * offset);
}

/**
 * Return the last `count` quarters ending with the current quarter.
 * Ordered most-recent first.
 *
 * Today (2026-03-24) falls in 1Q26, so:
 *   getRecentQuarters(5) → ["1Q26", "4Q25", "3Q25", "2Q25", "1Q25"]
 */
export function getRecentQuarters(count: number): string[] {
  const now = new Date();
  let quarter = Math.ceil((now.getMonth() + 1) / 3);
  let year = now.getFullYear();

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(formatQuarter(quarter, year));
    quarter--;
    if (quarter === 0) {
      quarter = 4;
      year--;
    }
  }
  return result;
}

/**
 * Return the quarter immediately after the given one.
 * "4Q25" → "1Q26", "3Q25" → "4Q25"
 */
export function nextQuarter(q: string): string {
  const { quarter, year } = parseQuarter(q);
  if (quarter === 4) return formatQuarter(1, year + 1);
  return formatQuarter(quarter + 1, year);
}
