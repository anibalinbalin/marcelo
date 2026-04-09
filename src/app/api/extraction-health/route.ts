import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxies the extraction FastAPI /health so the browser can poll from any
 * origin. Calling `headers()` opts into request-time execution so the result
 * is never prerendered or cached at the edge.
 */
export async function GET() {
  await headers();

  const base = process.env.EXTRACTION_API_URL;
  const noStore = {
    "Cache-Control": "no-store, max-age=0, must-revalidate",
  };

  if (!base) {
    return NextResponse.json(
      { ok: false, error: "EXTRACTION_API_URL not set" },
      { headers: noStore },
    );
  }

  const started = Date.now();
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, latencyMs, error: `upstream ${res.status}` },
        { headers: noStore },
      );
    }

    const upstream = (await res.json().catch(() => ({}))) as {
      status?: string;
      pdftoppm?: boolean;
    };

    return NextResponse.json(
      { ok: upstream.status === "ok", latencyMs, upstream },
      { headers: noStore },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "fetch failed",
      },
      { headers: noStore },
    );
  }
}
