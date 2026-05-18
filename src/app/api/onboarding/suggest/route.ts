/**
 * API endpoint for mapping suggestion during new company onboarding.
 *
 * Accepts a PDF upload, extracts tables, and returns ranked mapping candidates
 * using autoreason-style debate (Agent A: label similarity, Agent B: value patterns).
 */
import { NextRequest, NextResponse } from "next/server";
import { extractPdfTables } from "@/lib/pdf/extract";
import { extractPdfText } from "@/lib/pdf/extract-text";
import { suggestMappings, type MappingCandidate } from "@/lib/onboarding/suggest-mappings";
import { suggestXlsxMappings } from "@/lib/onboarding/suggest-xlsx-mappings";

export const maxDuration = 60; // Allow up to 60s for LLM calls

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const baseModelFile = formData.get("baseModelFile") as File | null;
    const sourceFile = (formData.get("sourceFile") as File | null) ?? file;
    const sourceType = (formData.get("sourceType") as string | null) ?? "pdf";
    const extractionMode = (formData.get("mode") as string) ?? "biva";

    if (sourceType === "xlsx") {
      if (!baseModelFile || !sourceFile) {
        return NextResponse.json(
          { error: "baseModelFile and sourceFile are required for XLSX onboarding" },
          { status: 400 }
        );
      }

      const result = await suggestXlsxMappings(
        Buffer.from(await baseModelFile.arrayBuffer()),
        Buffer.from(await sourceFile.arrayBuffer()),
      );

      const byTargetObj: Record<string, MappingCandidate[]> = {};
      for (const [key, candidates] of result.byTarget) {
        byTargetObj[key] = candidates;
      }

      return NextResponse.json({
        success: true,
        sourceType,
        candidateCount: result.candidates.length,
        byTarget: byTargetObj,
        durationMs: result.durationMs,
        candidates: result.candidates,
      });
    }

    if (!file) {
      return NextResponse.json(
        { error: "Missing required field: file" },
        { status: 400 }
      );
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Extract tables from PDF
    let sections;
    if (extractionMode === "ifrs_text") {
      // IFRS text extraction returns lines, convert to pseudo-sections
      const lines = await extractPdfText(fileBuffer);
      sections = [{
        code: "ifrs_text",
        pages: [1],
        tables: [{
          page: 1,
          headers: [] as string[],
          rows: lines.map(l => ({
            label: l.label,
            values: l.values as (number | null)[],
          })),
        }],
      }];
    } else {
      // BIVA-style table extraction
      sections = await extractPdfTables(fileBuffer);
    }

    if (!sections || sections.length === 0) {
      return NextResponse.json(
        { error: "No tables found in PDF" },
        { status: 400 }
      );
    }

    // Run mapping suggestion
    const result = await suggestMappings(sections);

    // Convert Map to object for JSON serialization
    const byTargetObj: Record<string, MappingCandidate[]> = {};
    for (const [key, candidates] of result.byTarget) {
      byTargetObj[key] = candidates;
    }

    return NextResponse.json({
      success: true,
      candidateCount: result.candidates.length,
      byTarget: byTargetObj,
      durationMs: result.durationMs,
      // Include raw candidates for flexibility
      candidates: result.candidates,
    });
  } catch (error) {
    console.error("[onboarding/suggest] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Suggestion failed" },
      { status: 500 }
    );
  }
}
