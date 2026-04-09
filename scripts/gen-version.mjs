#!/usr/bin/env node
/**
 * Generates public/version.json with a friendly version string (1.N where N
 * is total commit count) and the current SHA. Runs before `next build` so
 * the output is available at runtime on Vercel. Locally, `next dev` skips
 * the build step — the /api/version handler falls back to "dev" if the file
 * is missing.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function safeGit(...args) {
  try {
    return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// Vercel clones shallow by default — unshallow to get an accurate count.
safeGit("fetch", "--unshallow");

const countStr = safeGit("rev-list", "--count", "HEAD");
const count = Number.parseInt(countStr, 10);
const sha = process.env.VERCEL_GIT_COMMIT_SHA || safeGit("rev-parse", "HEAD") || "dev";

const version = Number.isFinite(count) && count > 0 ? `1.${count}` : "dev";

const payload = { version, sha };
const outDir = join(process.cwd(), "public");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "version.json"), JSON.stringify(payload) + "\n");

console.log(`[gen-version] wrote public/version.json -> ${JSON.stringify(payload)}`);
