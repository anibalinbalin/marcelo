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

/**
 * Extract tables from a BIVA quarterly PDF filing using pdfplumber.
 * Spawns a Python subprocess to do the extraction.
 */
export async function extractPdfTables(
  pdfBuffer: Buffer,
  sectionCodes?: string[]
): Promise<PdfSection[]> {
  // Write buffer to temp file
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
