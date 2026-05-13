import { put } from "@vercel/blob";
import { createRun, updateRunStatus } from "@/app/actions/runs";
import { getCompany } from "@/app/actions/companies";
import { runExtractionPipeline } from "@/lib/extraction/pipeline";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const companyId = formData.get("companyId") as string | null;
    const quarter = formData.get("quarter") as string | null;

    if (!file || !companyId || !quarter) {
      return NextResponse.json(
        { error: "Missing required fields: file, companyId, quarter" },
        { status: 400 }
      );
    }

    const parsedCompanyId = parseInt(companyId, 10);
    if (isNaN(parsedCompanyId)) {
      return NextResponse.json(
        { error: "Invalid companyId" },
        { status: 400 }
      );
    }

    // Validate file format matches company's studied source type
    const company = await getCompany(parsedCompanyId);
    if (company) {
      const fileName = file.name.toLowerCase();
      const isPdf = fileName.endsWith(".pdf");
      const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

      if (company.sourceType === "excel" && !isExcel) {
        return NextResponse.json(
          { error: `${company.name} requires XLSX files. Extraction mappings have not been analyzed for ${isPdf ? "PDF" : "this format"}.` },
          { status: 400 }
        );
      }
      if (company.sourceType === "pdf" && !isPdf) {
        return NextResponse.json(
          { error: `${company.name} requires PDF files. Extraction mappings have not been analyzed for ${isExcel ? "XLSX" : "this format"}.` },
          { status: 400 }
        );
      }
    }

    // Upload to Vercel Blob
    const blob = await put(`reports/${parsedCompanyId}/${quarter}/${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    });

    // Create extraction run
    const run = await createRun({
      companyId: parsedCompanyId,
      quarter,
      sourceFileUrl: blob.url,
    });

    // Run extraction pipeline
    let pipelineResult;
    try {
      pipelineResult = await runExtractionPipeline(run.id);
    } catch (pipelineErr) {
      const msg = pipelineErr instanceof Error ? pipelineErr.message : "Extraction failed";
      console.error(`[upload] Extraction failed for run ${run.id} (company ${parsedCompanyId}, ${quarter}):`, pipelineErr);
      await updateRunStatus(run.id, "error", { errorMessage: msg });
      return NextResponse.json({
        runId: run.id,
        status: "error",
        sourceFileUrl: blob.url,
        error: msg,
      }, { status: 200 }); // 200 because the upload succeeded; extraction failed
    }

    return NextResponse.json({
      runId: run.id,
      status: "extracted",
      sourceFileUrl: blob.url,
      extracted: pipelineResult.extracted,
      validated: pipelineResult.validated,
      warnings: pipelineResult.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
