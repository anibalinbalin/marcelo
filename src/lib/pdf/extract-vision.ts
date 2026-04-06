/**
 * Vision-based PDF extraction for image-heavy documents.
 *
 * When pdfplumber/text extraction fails (tables embedded as images),
 * renders pages as PNG via pdftoppm and sends to a vision model
 * (Claude via OpenRouter) to extract structured table data.
 *
 * Returns the same PdfSection format as extract.ts so the pipeline
 * can use it as a drop-in replacement.
 */
import { spawn } from "child_process";
import { writeFile, readFile, unlink, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { PdfSection, PdfTableRow } from "./extract";

interface VisionRow {
  label: string;
  values: (number | null)[];
}

const VISION_PROMPT = `Extract ALL rows from the financial tables on this page into JSON.
Return a JSON array where each element has {"label": "exact row label", "values": [col1, col2, col3, col4, col5]}.
Use negative numbers for parenthetical values like (599) → -599.
Preserve the exact column order as shown in the table headers.
Return ONLY valid JSON, no markdown fences, no commentary.`;

/**
 * Detect if a PDF page is image-heavy (tables as images, not extractable text).
 * Returns true if the page has large images and very few extractable words.
 */
export async function isImageHeavyPdf(pdfBuffer: Buffer, samplePages: number[] = [0]): Promise<boolean> {
  // Use pdfplumber to check word count vs image count on sample pages
  const tmpPath = join(tmpdir(), `vision-check-${randomUUID()}.pdf`);
  await writeFile(tmpPath, pdfBuffer);

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn("python3", ["-c", `
import pdfplumber, json, sys
pdf = pdfplumber.open("${tmpPath}")
pages = ${JSON.stringify(samplePages)}
results = []
for pi in pages:
    if pi < len(pdf.pages):
        page = pdf.pages[pi]
        words = len(page.extract_words())
        images = [i for i in page.images if i["width"] > 200 and i["height"] > 200]
        results.append({"page": pi, "words": words, "large_images": len(images)})
pdf.close()
print(json.dumps(results))
`]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code: number | null) => {
        if (code !== 0) reject(new Error(`Vision check failed: ${stderr}`));
        else resolve(stdout.trim());
      });
    });

    const checks: { page: number; words: number; large_images: number }[] = JSON.parse(result);
    // Image-heavy: pages with large images and <100 words of extractable text
    return checks.some(c => c.large_images > 0 && c.words < 100);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Render specific PDF pages as PNG images using pdftoppm (poppler).
 * Returns a map of page number → PNG buffer.
 */
async function renderPages(pdfBuffer: Buffer, pages: number[]): Promise<Map<number, Buffer>> {
  const id = randomUUID();
  const tmpPdf = join(tmpdir(), `vision-render-${id}.pdf`);
  const tmpPrefix = join(tmpdir(), `vision-img-${id}`);

  await writeFile(tmpPdf, pdfBuffer);

  const results = new Map<number, Buffer>();

  try {
    for (const pageNum of pages) {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("pdftoppm", [
          "-png", "-r", "200",
          "-f", String(pageNum), "-l", String(pageNum),
          tmpPdf, tmpPrefix,
        ]);
        proc.on("close", (code) => {
          if (code !== 0) reject(new Error(`pdftoppm failed for page ${pageNum}`));
          else resolve();
        });
        proc.on("error", (err) => reject(err));
      });

      // pdftoppm creates files like prefix-01.png, prefix-02.png etc.
      const dir = tmpdir();
      const files = await readdir(dir);
      const pageStr = String(pageNum).padStart(2, "0");
      const imgFile = files.find(f => f.startsWith(`vision-img-${id}`) && f.includes(pageStr) && f.endsWith(".png"))
        ?? files.find(f => f.startsWith(`vision-img-${id}`) && f.endsWith(".png"));

      if (imgFile) {
        const imgPath = join(dir, imgFile);
        results.set(pageNum, await readFile(imgPath));
        await unlink(imgPath).catch(() => {});
      }
    }
  } finally {
    await unlink(tmpPdf).catch(() => {});
    // Clean up any remaining image files
    const dir = tmpdir();
    const files = await readdir(dir);
    for (const f of files) {
      if (f.startsWith(`vision-img-${id}`)) {
        await unlink(join(dir, f)).catch(() => {});
      }
    }
  }

  return results;
}

/**
 * Send page images to vision model and extract structured table data.
 */
async function extractTablesFromImages(
  images: Map<number, Buffer>
): Promise<VisionRow[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set — needed for vision extraction");

  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });

  const allRows: VisionRow[] = [];

  for (const [pageNum, imgBuffer] of images) {
    const imgBase64 = imgBuffer.toString("base64");

    const result = await generateText({
      model: openrouter("anthropic/claude-sonnet-4"),
      messages: [{
        role: "user",
        content: [
          { type: "image" as const, image: imgBase64 },
          { type: "text", text: VISION_PROMPT },
        ],
      }],
    });

    let text = result.text.trim();
    // Strip markdown fences if present
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    try {
      const rows: VisionRow[] = JSON.parse(text);
      allRows.push(...rows);
    } catch {
      throw new Error(`Vision model returned invalid JSON for page ${pageNum}: ${text.slice(0, 200)}`);
    }
  }

  return allRows;
}

/**
 * Extract financial data from image-heavy PDF pages using vision.
 *
 * Converts vision output to the same PdfSection format used by BIVA extraction,
 * so the pipeline can process it identically.
 *
 * @param pdfBuffer - The full PDF file
 * @param pages - 1-indexed page numbers to extract (e.g., [33, 34, 36])
 * @param sectionCode - Section code to assign (e.g., "vision_is", "vision_bs")
 */
export async function extractPdfVision(
  pdfBuffer: Buffer,
  pages: number[],
  sectionCode: string = "vision"
): Promise<PdfSection> {
  const images = await renderPages(pdfBuffer, pages);

  if (images.size === 0) {
    throw new Error(`Failed to render any of pages ${pages.join(", ")}`);
  }

  const rows = await extractTablesFromImages(images);

  // Convert to PdfTableRow format
  const tableRows: PdfTableRow[] = rows
    .filter(r => r.label && r.values.some(v => v !== null))
    .map(r => ({
      label: r.label,
      values: r.values,
    }));

  return {
    code: sectionCode,
    pages,
    tables: [{
      page: pages[0],
      headers: [], // Vision doesn't produce headers in the same format
      rows: tableRows,
    }],
  };
}
