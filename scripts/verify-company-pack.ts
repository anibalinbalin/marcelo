import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { companyPacks, findCompanyPack, type RegisteredCompanyPack } from "../expectations/registry";

type Check = {
  ok: boolean;
  name: string;
  detail: string;
};

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const full = args.includes("--full");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length === 0) return { full };
  if (positional.length !== 2) {
    throw new Error("Usage: tsx scripts/verify-company-pack.ts [ticker quarter] [--full]");
  }
  return { ticker: positional[0], quarter: positional[1], full };
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function countKeys(value: Record<string, unknown> | undefined): number {
  return value ? Object.keys(value).length : 0;
}

function checkPack(pack: RegisteredCompanyPack, repoRoot: string): Check[] {
  const { manifest, expectations } = pack;
  const sourcePath = path.resolve(repoRoot, manifest.sourceFile);
  const checks: Check[] = [];

  checks.push({
    ok: manifest.companyId === expectations.companyId,
    name: `${manifest.id}: companyId`,
    detail: `${manifest.companyId} manifest / ${expectations.companyId} expectations`,
  });
  checks.push({
    ok: manifest.ticker === expectations.ticker && manifest.quarter === expectations.quarter,
    name: `${manifest.id}: ticker-quarter`,
    detail: `${manifest.ticker} ${manifest.quarter}`,
  });
  checks.push({
    ok: path.resolve(repoRoot, expectations.sourceFile) === sourcePath,
    name: `${manifest.id}: source path`,
    detail: manifest.sourceFile,
  });
  checks.push({
    ok: existsSync(sourcePath),
    name: `${manifest.id}: source exists`,
    detail: sourcePath,
  });

  if (existsSync(sourcePath)) {
    const actualHash = sha256(sourcePath);
    checks.push({
      ok: actualHash === manifest.sourceSha256,
      name: `${manifest.id}: source sha256`,
      detail: actualHash,
    });
  }

  const preApprovalCount = countKeys(expectations.projPreApprovalCells);
  checks.push({
    ok: preApprovalCount >= manifest.minimumAssertions.preApprovalCells,
    name: `${manifest.id}: pre-approval assertions`,
    detail: `${preApprovalCount} / minimum ${manifest.minimumAssertions.preApprovalCells}`,
  });

  const postRecalcCount = countKeys(expectations.fatAfterRecalc);
  checks.push({
    ok: postRecalcCount >= manifest.minimumAssertions.postRecalcCells,
    name: `${manifest.id}: post-recalc assertions`,
    detail: `${postRecalcCount} / minimum ${manifest.minimumAssertions.postRecalcCells}`,
  });

  checks.push({
    ok: expectations.projDuplicatePairs.length >= manifest.minimumAssertions.duplicatePairs,
    name: `${manifest.id}: duplicate-pair canaries`,
    detail: `${expectations.projDuplicatePairs.length} / minimum ${manifest.minimumAssertions.duplicatePairs}`,
  });

  checks.push({
    ok: expectations.minExtractedValues >= manifest.minimumAssertions.minExtractedValues,
    name: `${manifest.id}: min extracted values`,
    detail: `${expectations.minExtractedValues} / minimum ${manifest.minimumAssertions.minExtractedValues}`,
  });

  const duplicatePairCells = expectations.projDuplicatePairs.flatMap((pair) => [
    `${pair.sheet}:${pair.a}`,
    `${pair.sheet}:${pair.b}`,
  ]);
  const pinnedCells = new Set(Object.keys(expectations.projPreApprovalCells));
  const unpinned = duplicatePairCells.filter((cell) => !pinnedCells.has(cell));
  checks.push({
    ok: unpinned.length === 0,
    name: `${manifest.id}: duplicate pairs pinned`,
    detail: unpinned.length === 0 ? "all duplicate-pair cells have exact expected values" : unpinned.join(", "),
  });

  return checks;
}

function printChecks(checks: Check[]) {
  let failed = 0;
  for (const check of checks) {
    if (check.ok) {
      console.log(`✓ ${check.name} — ${check.detail}`);
    } else {
      failed++;
      console.log(`✗ ${check.name} — ${check.detail}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} preflight checks passed`);
  return failed;
}

function runFullCertification(pack: RegisteredCompanyPack) {
  console.log(`\n=== full certification: ${pack.manifest.ticker} ${pack.manifest.quarter} ===`);
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/fake-camila.ts", pack.manifest.ticker, pack.manifest.quarter],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const packs = args.ticker && args.quarter
    ? [findCompanyPack(args.ticker, args.quarter)]
    : companyPacks;

  if (packs.some((pack) => !pack)) {
    throw new Error(`No company pack registered for ${args.ticker} ${args.quarter}`);
  }

  const registeredPacks = packs as RegisteredCompanyPack[];
  const checks = registeredPacks.flatMap((pack) => checkPack(pack, repoRoot));
  const failed = printChecks(checks);
  if (failed > 0) process.exit(1);

  if (args.full) {
    for (const pack of registeredPacks) runFullCertification(pack);
  }
}

main();
