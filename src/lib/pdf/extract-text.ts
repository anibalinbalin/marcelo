/**
 * IFRS-style PDF text extraction — parses financial statements from
 * standard IFRS filings (Chilean CMF, etc.) using pdfplumber text extraction.
 *
 * Unlike BIVA filings which have structured section codes, IFRS statements
 * use free-form text with line items followed by numeric columns.
 */
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export interface ParsedLine {
  label: string;
  values: number[];
  page: number; // 1-indexed page number
}

/**
 * Extract financial data lines from an IFRS PDF using pdfplumber.
 * Returns an array of { label, values } where values[0] is the most recent period.
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<ParsedLine[]> {
  // On Vercel (no Python), fall back to Node.js text parsing
  if (process.env.VERCEL) {
    return extractPdfTextNode(pdfBuffer);
  }

  try {
    return await extractPdfTextPython(pdfBuffer);
  } catch {
    return extractPdfTextNode(pdfBuffer);
  }
}

/**
 * Python-based extraction using pdfplumber (local dev).
 */
async function extractPdfTextPython(pdfBuffer: Buffer): Promise<ParsedLine[]> {
  const tmpPath = join(tmpdir(), `pdf-text-${randomUUID()}.pdf`);
  await writeFile(tmpPath, pdfBuffer);

  try {
    const script = `
import pdfplumber, json, re, sys

def parse_number(s):
    if not s: return None
    s = s.strip()
    if not s or s in ('-', '—', ''): return None
    neg = False
    if s.startswith('(') and s.endswith(')'):
        neg = True
        s = s[1:-1]
    if s.startswith('-'):
        neg = True
        s = s[1:]
    # ALL dots are thousands separators in Chilean MUS$ statements
    parts_by_dot = s.split('.')
    if len(parts_by_dot) > 1 and all(len(p) == 3 or i == 0 for i, p in enumerate(parts_by_dot) if i > 0):
        s = s.replace('.', '')
    s = s.replace(',', '').replace(' ', '')
    try:
        v = float(s)
        return -v if neg else v
    except ValueError:
        return None

pdf_path = sys.argv[1]
results = []
with pdfplumber.open(pdf_path) as pdf:
    for page_idx, page in enumerate(pdf.pages[:15]):
        page_num = page_idx + 1
        text = page.extract_text() or ''
        for line in text.split('\\n'):
            line = line.strip()
            if not line or len(line) < 5: continue
            if re.match(r'^(nota\\b|note\\b|página|page\\b|\\d{1,2}[./])', line, re.I): continue
            # Tokenize on any whitespace, walk from the end collecting numeric
            # tokens. Stops at the first non-numeric token — that's the label
            # boundary. Handles both single- and multi-space column layouts.
            tokens = line.split()
            values_rev, raws_rev, stop_idx = [], [], 0
            for i in range(len(tokens) - 1, -1, -1):
                n = parse_number(tokens[i])
                if n is None:
                    stop_idx = i + 1
                    break
                values_rev.append(n)
                raws_rev.append(tokens[i])
                stop_idx = i
            values = list(reversed(values_rev))
            raws = list(reversed(raws_rev))
            label = ' '.join(tokens[:stop_idx]).strip()
            if not values or not label or len(label) < 3: continue
            # pdfplumber sometimes splits a leading capital from its word on
            # small-cap / kerned headings (e.g. "M argen de Contribución").
            # Rejoin: single capital followed by space + lowercase word.
            label = re.sub(r'\\b([A-ZÁÉÍÓÚÑ])\\s(?=[a-záéíóúñ])', r'\\1', label)
            # Note-ref heuristic: Chilean IFRS MUS$ statements have note-ref
            # columns containing small bare ints (e.g. "20", "24") next to
            # dotted thousands values (e.g. "129.594"). If values[0] is a
            # bare small int and the rest are dotted, drop it as a note ref
            # and fold it into the label for stripNoteRef downstream.
            if len(values) >= 2 and '.' not in raws[0] and abs(values[0]) < 100:
                dotted_rest = sum(1 for r in raws[1:] if '.' in r)
                if dotted_rest >= len(raws) - 2:
                    label = (label + ' ' + raws[0]).strip()
                    values = values[1:]
            if values:
                results.append({'label': label, 'values': values, 'page': page_num})

print(json.dumps(results, ensure_ascii=False))
`;

    const scriptPath = join(tmpdir(), `ifrs-extract-${randomUUID()}.py`);
    await writeFile(scriptPath, script);

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn("python3", [scriptPath, tmpPath]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });
      proc.on("close", (code) => {
        if (code !== 0) reject(new Error(`IFRS extraction failed: ${stderr}`));
        else resolve(stdout);
      });
      proc.on("error", (err) => reject(err));
    });

    await unlink(scriptPath).catch(() => {});
    return JSON.parse(result) as ParsedLine[];
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Node.js fallback for Vercel serverless (no Python).
 * Uses unpdf for pure JS PDF text extraction.
 */
async function extractPdfTextNode(pdfBuffer: Buffer): Promise<ParsedLine[]> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(pdfBuffer), { mergePages: false });

  const pages = result.text?.slice(0, 15) ?? [];
  const allLines: ParsedLine[] = [];
  for (let i = 0; i < pages.length; i++) {
    allLines.push(...parseTextLines(pages[i], i + 1));
  }
  return allLines;
}

function parseNumber(s: string): number | null {
  if (!s) return null;
  s = s.trim();
  if (!s || s === "-" || s === "—") return null;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  // In Chilean IFRS MUS$ statements, dots are ALWAYS thousands separators.
  // "665.902" = 665,902 (not 665.902). "3.372.610" = 3,372,610.
  // Rule: if a dot is followed by exactly 3 digits (and end-of-string or another dot),
  // it's a thousands separator. Otherwise treat as decimal.
  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount > 0) {
    // Check if ALL dots are followed by exactly 3 digits
    const allDotsAreThousands = s.split(".").slice(1).every((part) => /^\d{3}/.test(part));
    if (allDotsAreThousands) {
      s = s.replace(/\./g, "");
    }
  }
  s = s.replace(/,/g, "").replace(/\s/g, "");

  const val = parseFloat(s);
  if (isNaN(val)) return null;
  return negative ? -val : val;
}

function parseTextLines(text: string, pageNum: number = 1): ParsedLine[] {
  const lines = text.split("\n");
  const results: ParsedLine[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 5) continue;
    if (/^(nota\b|note\b|página|page\b|\d{1,2}[\./])/i.test(line)) continue;

    // Tokenize on whitespace, walk from the end collecting numeric tokens.
    // Stops at the first non-numeric token — that's the label boundary.
    // Handles both single- and multi-space column layouts.
    const tokens = line.split(/\s+/);
    const valuesRev: number[] = [];
    const rawsRev: string[] = [];
    let stopIdx = 0;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const n = parseNumber(tokens[i]);
      if (n === null) {
        stopIdx = i + 1;
        break;
      }
      valuesRev.push(n);
      rawsRev.push(tokens[i]);
      stopIdx = i;
    }
    const values = valuesRev.reverse();
    const raws = rawsRev.reverse();
    let label = tokens.slice(0, stopIdx).join(" ").trim();
    if (!values.length || !label || label.length < 3) continue;

    // pdfplumber sometimes splits a leading capital from its word on
    // small-cap / kerned headings (e.g. "M argen de Contribución"). Rejoin.
    label = label.replace(/\b([A-ZÁÉÍÓÚÑ])\s(?=[a-záéíóúñ])/g, "$1");

    // Note-ref heuristic: Chilean IFRS MUS$ statements have a note-ref column
    // with small bare ints next to dotted thousands values. If values[0] is
    // a bare small int and the rest are dotted, drop it and fold into label.
    if (values.length >= 2 && !raws[0].includes(".") && Math.abs(values[0]) < 100) {
      const dottedRest = raws.slice(1).filter((r) => r.includes(".")).length;
      if (dottedRest >= raws.length - 2) {
        label = (label + " " + raws[0]).trim();
        values.shift();
      }
    }

    if (values.length > 0) {
      results.push({ label, values, page: pageNum });
    }
  }

  return results;
}
