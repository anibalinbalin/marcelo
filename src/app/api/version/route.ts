import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Returns the current deploy's git SHA. Clients poll this to detect when a
 * new version has been deployed. Calling `headers()` opts into request-time
 * execution so the value is never prerendered or cached at the edge.
 */
export async function GET() {
  await headers();

  const version = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

  return NextResponse.json(
    { version },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    }
  );
}
