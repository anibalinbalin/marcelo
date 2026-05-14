/**
 * Run fake-camila for every registered company pack.
 *
 * Usage:
 *   pnpm tsx scripts/fake-camila-all.ts [--keep]
 */
import { spawnSync } from "node:child_process";
import { companyPacks } from "../expectations/registry";

const keep = process.argv.includes("--keep");

interface Result {
  ticker: string;
  quarter: string;
  ok: boolean;
  duration: number;
}

const results: Result[] = [];

for (const pack of companyPacks) {
  const { ticker, quarter } = pack.manifest;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Running fake-camila: ${ticker} ${quarter}`);
  console.log("=".repeat(60));

  const t0 = Date.now();
  const args = ["tsx", "scripts/fake-camila.ts", ticker, quarter];
  if (keep) args.push("--keep");

  const child = spawnSync("pnpm", args, {
    stdio: "inherit",
    timeout: 300_000,
  });
  const duration = (Date.now() - t0) / 1000;
  const ok = child.status === 0;
  results.push({ ticker, quarter, ok, duration });

  if (!ok) {
    console.error(`\n  FAILED: ${ticker} ${quarter} (exit ${child.status})`);
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log("  SUMMARY");
console.log("=".repeat(60));

let allPassed = true;
for (const r of results) {
  const icon = r.ok ? "PASS" : "FAIL";
  console.log(`  ${icon}  ${r.ticker} ${r.quarter}  (${r.duration.toFixed(1)}s)`);
  if (!r.ok) allPassed = false;
}

console.log(`\n  ${results.length} companies, ${results.filter(r => r.ok).length} passed, ${results.filter(r => !r.ok).length} failed`);
process.exit(allPassed ? 0 : 1);
