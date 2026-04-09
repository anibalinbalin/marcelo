import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * Returns the current deploy's friendly version string and git SHA. Clients
 * poll this to detect when a new version has been deployed. Calling
 * `headers()` opts into request-time execution so the value is never
 * prerendered or cached at the edge.
 *
 * The `version` field is "1.N" where N is the total commit count, generated
 * at build time by scripts/gen-version.mjs. Falls back to "dev" in local
 * `next dev` where no prebuild runs.
 */
export async function GET() {
  await headers();

  let version = "dev";
  let sha = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

  try {
    const raw = await readFile(join(process.cwd(), "public", "version.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string; sha?: string };
    if (parsed.version) version = parsed.version;
    if (parsed.sha) sha = parsed.sha;
  } catch {
    // file missing in dev — leave defaults
  }

  return NextResponse.json(
    { version, sha },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    }
  );
}
