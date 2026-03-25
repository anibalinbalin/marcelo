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

interface ParsedLine {
  label: string;
  values: number[];
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
    dots = s.count('.')
    if dots > 1:
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
    for page in pdf.pages[:15]:
        text = page.extract_text() or ''
        for line in text.split('\\n'):
            line = line.strip()
            if not line or len(line) < 3: continue
            parts = re.split(r'\\s{2,}', line)
            if len(parts) < 2: continue
            label = parts[0].strip()
            if not label or len(label) < 3: continue
            if re.match(r'^(nota|note|pag|page|\\d{1,2}[./])', label, re.I): continue
            values = []
            for p in parts[1:]:
                n = parse_number(p.strip())
                if n is not None:
                    values.append(n)
            if values:
                results.append({'label': label, 'values': values})

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

  // Concatenate first 15 pages
  const pages = result.text?.slice(0, 15) ?? [];
  const fullText = pages.join("\n");

  return parseTextLines(fullText);
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

  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount > 1) {
    s = s.replace(/\./g, "");
  }
  s = s.replace(/,/g, "").replace(/\s/g, "");

  const val = parseFloat(s);
  if (isNaN(val)) return null;
  return negative ? -val : val;
}

function parseTextLines(text: string): ParsedLine[] {
  const lines = text.split("\n");
  const results: ParsedLine[] = [];

  // Pattern: numbers in IFRS format — e.g., "3.372.610", "(2.157.881)", "39.774", "-"
  // Numbers can have dots as thousands separators and parens for negatives
  const numberPattern = /(?:\([\d.]+\)|(?<!\w)-?[\d.]+(?:,\d+)?)/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 5) continue;
    if (/^(nota|note|pag|page|\d{1,2}[\./])/i.test(line)) continue;

    // Find all numbers in the line
    const matches = [...line.matchAll(numberPattern)];
    if (matches.length === 0) continue;

    // The label is everything before the first number match
    const firstMatchIdx = matches[0].index!;
    let label = line.substring(0, firstMatchIdx).trim();

    // Skip if label is too short or empty
    if (!label || label.length < 3) continue;

    // Strip trailing note references like " 28" or " 33"
    label = label.replace(/\s+\d{1,3}$/, "").trim();
    if (!label) continue;

    // Parse all the number matches
    const values: number[] = [];
    for (const m of matches) {
      const num = parseNumber(m[0]);
      if (num !== null) values.push(num);
    }

    if (values.length > 0) {
      results.push({ label, values });
    }
  }

  return results;
}
