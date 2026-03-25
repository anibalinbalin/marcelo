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
 * Uses pdf-parse PDFParse class.
 */
async function extractPdfTextNode(pdfBuffer: Buffer): Promise<ParsedLine[]> {
  const pdfParseModule = await import("pdf-parse");
  const PDFParseClass = (pdfParseModule as Record<string, unknown>).PDFParse as {
    new (data: Uint8Array): {
      load(): Promise<void>;
      getInfo(): Promise<{ numPages?: number }>;
      getPageText(page: number): Promise<string>;
    };
  };

  const parser = new PDFParseClass(new Uint8Array(pdfBuffer));
  await parser.load();

  const info = await parser.getInfo();
  const numPages = info.numPages || 15;

  let fullText = "";
  for (let i = 1; i <= Math.min(15, numPages); i++) {
    try {
      const pageText = await parser.getPageText(i);
      fullText += pageText + "\n";
    } catch {
      break;
    }
  }

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

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 3) continue;

    const parts = line.split(/\s{2,}/);
    if (parts.length < 2) continue;

    const label = parts[0].trim();
    if (!label || label.length < 2) continue;
    if (/^(nota|note|pag|page|\d{1,2}[\./])/i.test(label)) continue;

    const values: number[] = [];
    for (let i = 1; i < parts.length; i++) {
      const num = parseNumber(parts[i].trim());
      if (num !== null) values.push(num);
    }

    if (values.length > 0) {
      results.push({ label, values });
    }
  }

  return results;
}
