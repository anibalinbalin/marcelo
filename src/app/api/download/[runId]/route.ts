import { NextRequest, NextResponse } from "next/server";
import { generatePopulatedExcel } from "@/lib/writeback";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const runIdNum = parseInt(runId, 10);
  if (isNaN(runIdNum)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }

  try {
    const result = await generatePopulatedExcel(runIdNum);

    if (result.integrityWarnings.length > 0) {
      console.info(
        `[download ${runIdNum}] integrity warnings:`,
        result.integrityWarnings
      );
    }

    // Hard integrity failure — at least one written cell did not land in the
    // output file. Block the download so the analyst never ships broken data.
    if (result.integrityErrors.length > 0) {
      console.error(
        `[download ${runIdNum}] integrity FAILED, blocking download:`,
        result.integrityErrors
      );
      return NextResponse.json(
        {
          error:
            "Integrity check failed: some extracted values did not land in the output file.",
          details: result.integrityErrors,
          cellsWritten: result.cellsWritten,
        },
        { status: 422 }
      );
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Cells-Written": result.cellsWritten.toString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[download ${runIdNum}] error:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
