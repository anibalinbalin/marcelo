#!/usr/bin/env node
/**
 * Generates public/version.json with a friendly version string (1.N where N
 * is total commit count reachable from HEAD) and the current SHA. Runs
 * before `next build`.
 *
 * Vercel clones repos with depth 10, so `git rev-list --count HEAD` only
 * returns 10 in that environment. When running on Vercel, we ask the
 * GitHub API for the real count instead. Locally, we use git directly.
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

async function githubCommitCount(owner, repo, sha) {
  if (!owner || !repo || !sha) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${sha}&per_page=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "marcelo-gen-version" },
    });
    if (!res.ok) return null;
    const link = res.headers.get("link") || "";
    // Link: <...&page=2>; rel="next", <...&page=137>; rel="last"
    const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (!match) {
      // Single-page result — at most 1 commit.
      return 1;
    }
    return Number.parseInt(match[1], 10);
  } catch {
    return null;
  }
}

const owner = process.env.VERCEL_GIT_REPO_OWNER;
const repo = process.env.VERCEL_GIT_REPO_SLUG;
const sha = process.env.VERCEL_GIT_COMMIT_SHA || safeGit("rev-parse", "HEAD") || "dev";

let count = null;

// Prefer GitHub API on Vercel (shallow clone doesn't have full history).
if (process.env.VERCEL) {
  count = await githubCommitCount(owner, repo, sha);
}

// Fallback to local git.
if (count === null || !Number.isFinite(count) || count <= 0) {
  const raw = safeGit("rev-list", "--count", "HEAD");
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) count = parsed;
}

const version = count && count > 0 ? `1.${count}` : "dev";

const payload = { version, sha };
const outDir = join(process.cwd(), "public");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "version.json"), JSON.stringify(payload) + "\n");

console.log(`[gen-version] wrote public/version.json -> ${JSON.stringify(payload)}`);
