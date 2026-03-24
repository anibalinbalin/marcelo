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

    if (result.integrityErrors.length > 0) {
      console.warn("Integrity warnings during writeback:", result.integrityErrors);
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
