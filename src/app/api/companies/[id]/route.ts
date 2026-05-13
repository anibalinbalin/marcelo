import { getCompany } from "@/app/actions/companies";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsedId = parseInt(id, 10);
  if (isNaN(parsedId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const company = await getCompany(parsedId);
  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: company.id,
    name: company.name,
    ticker: company.ticker,
    sourceType: company.sourceType,
  });
}
