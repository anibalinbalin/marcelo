import { NextRequest, NextResponse } from "next/server";
import { extractLarrainVial } from "@/lib/pdf/extract-larrainvial";
import { reconcileSimultaneas } from "@/lib/extraction/reconcile-simultaneas";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const fileA = formData.get("fileA") as File | null;
    const fileB = formData.get("fileB") as File | null;

    if (!fileA || !fileB) {
      return NextResponse.json(
        { error: "Two PDF files required: fileA and fileB" },
        { status: 400 }
      );
    }

    const [bufferA, bufferB] = await Promise.all([
      fileA.arrayBuffer().then(Buffer.from),
      fileB.arrayBuffer().then(Buffer.from),
    ]);

    const [extractA, extractB] = await Promise.all([
      extractLarrainVial(bufferA),
      extractLarrainVial(bufferB),
    ]);

    if (!extractA.date || !extractB.date) {
      return NextResponse.json(
        {
          error: "Could not determine statement date from one or both PDFs",
          dates: { a: extractA.date, b: extractB.date },
        },
        { status: 422 }
      );
    }

    const result = reconcileSimultaneas(extractA, extractB);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reconciliation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
