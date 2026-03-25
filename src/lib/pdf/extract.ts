import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export interface PdfTableRow {
  label: string;
  values: (number | null)[];
}

export interface PdfTable {
  page: number;
  headers: string[];
  rows: PdfTableRow[];
}

export interface PdfSection {
  code: string;
  pages: number[];
  tables: PdfTable[];
}

const KNOWN_SECTIONS = [
  "[210000]", "[310000]", "[410000]", "[520000]", "[610000]",
  "[700000]", "[700002]", "[800001]", "[800005]", "[800100]", "[800200]",
];

/**
 * Parse a number string, handling commas, parenthetical negatives, etc.
 */
function parseNumber(s: string): number | null {
  if (!s) return null;
  s = s.trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  s = s.replace(/,/g, "").replace(/\s/g, "");

  const val = parseFloat(s);
  if (isNaN(val)) return null;
  return negative ? -val : val;
}

/**
 * Node.js-based PDF text extraction fallback for Vercel serverless.
 * Uses pdf-parse to get raw text, then parses BIVA section structure.
 */
async function extractPdfTablesNode(
  pdfBuffer: Buffer,
  sectionCodes?: string[]
): Promise<PdfSection[]> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(pdfBuffer), { mergePages: true });
  const text = result.text ?? "";

  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  const filterCodes = sectionCodes ? new Set(sectionCodes) : null;

  const sections: PdfSection[] = [];
  let currentSection: PdfSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers like "[310000]"
    for (const code of KNOWN_SECTIONS) {
      if (line.includes(code)) {
        if (filterCodes && !filterCodes.has(code)) break;

        // Start new section or find existing
        let existing = sections.find((s) => s.code === code);
        if (!existing) {
          existing = { code, pages: [], tables: [{ page: 0, headers: [], rows: [] }] };
          sections.push(existing);
        }
        currentSection = existing;
        break;
      }
    }

    // Try to parse data rows: label followed by numbers
    if (currentSection && currentSection.tables.length > 0) {
      // Skip header/meta rows
      if (line.startsWith("Concepto") || line.includes("[sinopsis]")) continue;

      // Split on 2+ spaces to separate label from values
      const parts = line.split(/\s{2,}/);
      if (parts.length >= 2) {
        const label = parts[0].trim();
        const values = parts.slice(1).map((p: string) => parseNumber(p));

        // Only add if we got at least one numeric value and a non-empty label
        if (label && values.some((v: number | null) => v !== null)) {
          currentSection.tables[0].rows.push({ label, values });
        }
      }
    }
  }

  return sections;
}

/**
 * Extract tables from a BIVA quarterly PDF filing.
 * Uses pdfplumber (Python) locally, falls back to pdf-parse (Node.js) on Vercel.
 */
export async function extractPdfTables(
  pdfBuffer: Buffer,
  sectionCodes?: string[]
): Promise<PdfSection[]> {
  // On Vercel, use Node.js-based extraction (no Python available)
  if (process.env.VERCEL) {
    return extractPdfTablesNode(pdfBuffer, sectionCodes);
  }

  // Locally, try pdfplumber first, fall back to Node.js
  try {
    return await extractPdfTablesPython(pdfBuffer, sectionCodes);
  } catch {
    return extractPdfTablesNode(pdfBuffer, sectionCodes);
  }
}

/**
 * Extract tables using pdfplumber Python subprocess (local dev only).
 */
async function extractPdfTablesPython(
  pdfBuffer: Buffer,
  sectionCodes?: string[]
): Promise<PdfSection[]> {
  const tmpPath = join(tmpdir(), `pdf-extract-${randomUUID()}.pdf`);
  await writeFile(tmpPath, pdfBuffer);

  try {
    const scriptPath = join(process.cwd(), "src/lib/pdf/extract.py");
    const args = [scriptPath, tmpPath, ...(sectionCodes || [])];

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn("python3", args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`pdfplumber extraction failed (exit ${code}): ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn python3: ${err.message}`));
      });
    });

    return JSON.parse(result) as PdfSection[];
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
