import { put } from "@vercel/blob";
import { createRun } from "@/app/actions/runs";
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

    // Upload to Vercel Blob
    const blob = await put(`reports/${parsedCompanyId}/${quarter}/${file.name}`, file, {
      access: "public",
    });

    // Create extraction run
    const run = await createRun({
      companyId: parsedCompanyId,
      quarter,
      sourceFileUrl: blob.url,
    });

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      sourceFileUrl: blob.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
