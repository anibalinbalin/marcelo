import { extractPdfTables, type PdfSection } from "../pdf/extract";
import { extractPdfText, type ParsedLine } from "../pdf/extract-text";
import { extractPdfVision } from "../pdf/extract-vision";
import { extractBimboJudgeEvidence } from "../validation/source-judge";
import type { SourceEvidenceExpectation } from "../../../expectations/types";

export function buildPdfSectionJudgeEvidence(sections: PdfSection[]): string {
  return sections
    .flatMap((section) =>
      section.tables.flatMap((table) =>
        table.rows.map((row) => {
          const values = row.values.filter((value) => value !== null).join(", ");
          return `section=${section.code} page=${table.page} label="${row.label}" values=${values}`;
        }),
      ),
    )
    .slice(0, 160)
    .join("\n");
}

export function buildIfrsTextJudgeEvidence(lines: ParsedLine[]): string {
  return lines
    .slice(0, 180)
    .map((line) => `page=${line.page} label="${line.label}" values=${line.values.join(", ")}`)
    .join("\n");
}

function parseVisionSection(section: string): { code: string; pages: number[] } {
  const [, pageSpec] = section.split(":");
  const pages = pageSpec
    ?.split(",")
    .map((page) => Number(page.trim()))
    .filter((page) => Number.isFinite(page) && page > 0);

  if (!pages?.length) {
    throw new Error(`Invalid vision source section "${section}"`);
  }

  return { code: section, pages };
}

export async function buildPdfSourceEvidence(
  pdfBuffer: Buffer,
  expectation: SourceEvidenceExpectation,
): Promise<string> {
  if (expectation.kind === "bimbo_press_release") {
    return extractBimboJudgeEvidence(pdfBuffer);
  }

  if (expectation.kind === "ifrs_text") {
    return buildIfrsTextJudgeEvidence(await extractPdfText(pdfBuffer));
  }

  if (expectation.kind === "vision_pdf") {
    const sections = await Promise.all(
      (expectation.visionSections ?? []).map(async (section) => {
        const { code, pages } = parseVisionSection(section);
        return extractPdfVision(pdfBuffer, pages, code);
      }),
    );
    return buildPdfSectionJudgeEvidence(sections);
  }

  return buildPdfSectionJudgeEvidence(
    await extractPdfTables(pdfBuffer, expectation.sectionCodes),
  );
}

export function missingEvidenceLabels(evidence: string, labels: string[]): string[] {
  const normalizedEvidence = evidence.toLocaleLowerCase("es");
  return labels.filter(
    (label) => !normalizedEvidence.includes(label.toLocaleLowerCase("es")),
  );
}
