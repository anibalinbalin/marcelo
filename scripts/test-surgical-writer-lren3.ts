/**
 * Standalone test: run the surgical writer against the LREN3 template with
 * synthetic values at all 41 LREN3 CL targets and verify:
 *   - no integrity errors
 *   - every target cell in PROJ!CL* ends up as <v>VALUE</v> with no <f>
 *   - shared-master promotions for CL23 and CL90 land at CM23/CM90 with
 *     shifted formulas, and the other clones still reference the same si
 *   - CL99/CL100 shared group fully collapses (no surviving clone)
 *
 * Runs entirely in-process — no DB, no network.
 */
import { readFileSync, writeFileSync } from "fs";
import JSZip from "jszip";
import { writeBlueValues, type CellWrite } from "@/lib/excel/surgical-writer";

const TEMPLATE = "public/camila/LREN3 OK.xlsx";
const OUT = "/tmp/LREN3_surgical_test.xlsx";

// The 41 LREN3 target rows (PROJ sheet, column CL for 4Q25).
const TARGET_ROWS = [
  3, 7, 11, 12, 13, 14, 15, 23, 32, 90, 91, 92, 93, 94, 95, 99, 100, 103, 104,
  105, 106, 107, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
  121, 122, 123, 125, 126, 128, 212,
];

// Column CL = col 90 (A=1, ..., Z=26, AA=27, ..., CL = 3*26 + 12 = 90).
const CL_COL = 90;

function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function assertEq<T>(name: string, got: T, want: T): void {
  if (got !== want) {
    throw new Error(`${name}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}

async function main(): Promise<void> {
  console.log("=== LREN3 surgical writer test ===");
  console.log(`CL = col ${CL_COL} (expected 90): ${colToNum("CL")}`);
  assertEq("CL col number", colToNum("CL"), 90);

  const buf = readFileSync(TEMPLATE);
  const writes: CellWrite[] = TARGET_ROWS.map((row, i) => ({
    sheet: "PROJ",
    row,
    col: CL_COL,
    // Use recognizable synthetic values: 10000 + index, so CL3=10000, CL7=10001, ...
    value: 10000 + i,
  }));

  const { buffer, integrityReport } = await writeBlueValues(buf, writes);
  writeFileSync(OUT, buffer);
  console.log(`Wrote ${OUT} (${buffer.length} bytes)`);

  console.log("\nIntegrity report:");
  console.log(`  sheetCountMatch: ${integrityReport.sheetCountMatch}`);
  console.log(`  writtenCellsVerified: ${integrityReport.writtenCellsVerified}`);
  console.log(`  errors: ${integrityReport.errors.length}`);
  if (integrityReport.errors.length > 0) {
    for (const e of integrityReport.errors) console.log(`    ! ${e}`);
  }
  console.log(`  warnings: ${integrityReport.warnings.length}`);
  for (const w of integrityReport.warnings) console.log(`    - ${w}`);

  if (integrityReport.errors.length > 0) {
    throw new Error("integrity errors present — see above");
  }
  if (!integrityReport.writtenCellsVerified) {
    throw new Error("writtenCellsVerified=false");
  }

  // Re-open the output and inspect PROJ sheet XML.
  const zip = await JSZip.loadAsync(buffer);
  const projFile = zip.file("xl/worksheets/sheet5.xml");
  if (!projFile) throw new Error("PROJ sheet missing from output");
  const xml = await projFile.async("string");

  // Check every target cell: must have <v>NNN</v> and must NOT contain <f ...>
  let allGood = true;
  for (let i = 0; i < TARGET_ROWS.length; i++) {
    const row = TARGET_ROWS[i];
    const addr = `CL${row}`;
    const expected = 10000 + i;
    const re = new RegExp(
      `<c\\b[^>]*\\br="${addr}"[^>]*?>([\\s\\S]*?)</c>`,
    );
    const m = xml.match(re);
    if (!m) {
      console.log(`  [FAIL] ${addr} not found in output`);
      allGood = false;
      continue;
    }
    const inner = m[1];
    if (/<f\b/.test(inner)) {
      console.log(`  [FAIL] ${addr} still has <f>: ${m[0].slice(0, 120)}`);
      allGood = false;
      continue;
    }
    const vm = inner.match(/<v>([^<]+)<\/v>/);
    if (!vm) {
      console.log(`  [FAIL] ${addr} has no <v>: ${m[0].slice(0, 120)}`);
      allGood = false;
      continue;
    }
    const got = parseFloat(vm[1]);
    if (got !== expected) {
      console.log(`  [FAIL] ${addr} value=${got}, expected=${expected}`);
      allGood = false;
      continue;
    }
  }

  // Verify shared-master promotions.
  // Case 1: CL23 was master for si=72 over CL23:CP23. Clones CM23..CP23
  // should survive. CM23 should now be the new master with shifted formula
  // "CM225" and ref="CM23:CP23".
  console.log("\nShared-master promotions:");
  const cm23re = /<c\b[^>]*\br="CM23"[^>]*>([\s\S]*?)<\/c>/;
  const cm23 = xml.match(cm23re);
  if (!cm23) {
    console.log("  [FAIL] CM23 missing");
    allGood = false;
  } else {
    const fm = cm23[1].match(/<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/);
    if (!fm) {
      console.log(`  [FAIL] CM23 has no <f> — promotion failed: ${cm23[0].slice(0, 200)}`);
      allGood = false;
    } else {
      const attrs = fm[1];
      const body = fm[2] ?? "";
      console.log(`  CM23: attrs=${attrs.trim()} body="${body}"`);
      if (!/ref="CM23:CP23"/.test(attrs)) {
        console.log(`    [FAIL] CM23 ref not shifted: ${attrs}`);
        allGood = false;
      }
      if (!/si="72"/.test(attrs)) {
        console.log(`    [FAIL] CM23 si=72 lost: ${attrs}`);
        allGood = false;
      }
      if (body.trim() !== "CM225") {
        console.log(`    [FAIL] CM23 body not shifted: "${body}" (want "CM225")`);
        allGood = false;
      }
    }
  }

  // Case 2: CL90 master for si=1391 over CL90:CP90, body
  // "+CL128-CL91-CL92-CL93-CL94-CL95-CL96-CL102" → CM90 with shifted body.
  const cm90re = /<c\b[^>]*\br="CM90"[^>]*>([\s\S]*?)<\/c>/;
  const cm90 = xml.match(cm90re);
  if (!cm90) {
    console.log("  [FAIL] CM90 missing");
    allGood = false;
  } else {
    const fm = cm90[1].match(/<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/);
    if (!fm) {
      console.log(`  [FAIL] CM90 has no <f>: ${cm90[0].slice(0, 200)}`);
      allGood = false;
    } else {
      const attrs = fm[1];
      const body = fm[2] ?? "";
      console.log(`  CM90: attrs=${attrs.trim()} body="${body}"`);
      const wantBody = "+CM128-CM91-CM92-CM93-CM94-CM95-CM96-CM102";
      if (body.trim() !== wantBody) {
        console.log(`    [FAIL] CM90 body="${body}" want="${wantBody}"`);
        allGood = false;
      }
      if (!/ref="CM90:CP90"/.test(attrs)) {
        console.log(`    [FAIL] CM90 ref not shifted: ${attrs}`);
        allGood = false;
      }
      if (!/si="1391"/.test(attrs)) {
        console.log(`    [FAIL] CM90 si lost: ${attrs}`);
        allGood = false;
      }
    }
  }

  // Case 3: CL99/CL100 si=1450 was master+clone, both demoted. No cells
  // in CL99:CL100 range should reference si=1450 anymore. Checking: CL99
  // must be literal (already checked above). CL100 must be literal too.
  // Additionally: no other cell in the sheet should mention si="1450" as
  // a clone (they would have been orphaned).
  const orphanRe = /<f\b[^>]*?\bsi="1450"[^>]*?(?:\/>|>[^<]*<\/f>)/g;
  const orphans: string[] = [];
  for (const om of xml.matchAll(orphanRe)) {
    orphans.push(om[0]);
  }
  if (orphans.length > 0) {
    console.log(`  [FAIL] si=1450 still referenced after demotion:`);
    for (const o of orphans) console.log(`    ${o}`);
    allGood = false;
  } else {
    console.log("  si=1450 fully collapsed ✓");
  }

  // Case 4: surviving clones should still reference their master's si.
  // Check that CN23 still has `<f t="shared" si="72"/>` — after promotion it
  // still references si=72 (the new master is CM23, not CL23).
  for (const cloneAddr of ["CN23", "CO23", "CP23"]) {
    const cre = new RegExp(`<c\\b[^>]*\\br="${cloneAddr}"[^>]*>([\\s\\S]*?)</c>`);
    const cm = xml.match(cre);
    if (!cm) {
      console.log(`  [FAIL] surviving clone ${cloneAddr} missing`);
      allGood = false;
      continue;
    }
    if (!/<f\b[^>]*?\bsi="72"/.test(cm[1])) {
      console.log(`  [FAIL] clone ${cloneAddr} lost si=72: ${cm[0].slice(0, 200)}`);
      allGood = false;
    }
  }

  if (!allGood) {
    console.log("\n=== FAIL ===");
    process.exit(1);
  }
  console.log("\n=== PASS ===");
  console.log(`Output: ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
