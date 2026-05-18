import { getRun } from "@/app/actions/runs";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = await getRun(Number(runId));
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ status: run.status });
}
