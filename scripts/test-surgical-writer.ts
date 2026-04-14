/**
 * Smoke test for src/lib/excel/surgical-writer.ts.
 *
 * Takes the real CENT template, writes a handful of values into PROJ, and
 * compares the output archive to the original file-by-file. The goal is to
 * prove the surgical writer preserves all charts / external links / printer
 * settings / rich data that ExcelJS strips on round-trip.
 */
import * as fs from "fs";
import JSZip from "jszip";
import { writeBlueValues, type CellWrite } from "../src/lib/excel/surgical-writer";

async function main() {
  const inputPath = "/tmp/CENT_4Q25_orig.xlsx";
  const outputPath = "/tmp/CENT_4Q25_surgical.xlsx";

  if (!fs.existsSync(inputPath)) {
    console.error(`Missing ${inputPath} — download the CENT template first.`);
    process.exit(1);
  }

  const buf = fs.readFileSync(inputPath);
  console.log(`Input:  ${inputPath} (${buf.length} bytes)`);

  // Inspect original zip contents.
  const origZip = await JSZip.loadAsync(buf);
  const origPaths = Object.keys(origZip.files).filter((p) => !origZip.files[p].dir);
  console.log(`Original archive: ${origPaths.length} files`);

  // Pick some PROJ target cells based on what the CENT pipeline writes
  // (empty self-closing placeholders in column C of PROJ).
  const writes: CellWrite[] = [
    { sheet: "PROJ", row: 3, col: 3, value: 1234.56 },
    { sheet: "PROJ", row: 4, col: 3, value: -789.01 },
    { sheet: "PROJ", row: 5, col: 3, value: 0 },
  ];

  const { buffer, integrityReport } = await writeBlueValues(buf, writes);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Output: ${outputPath} (${buffer.length} bytes)`);

  const outZip = await JSZip.loadAsync(buffer);
  const outPaths = Object.keys(outZip.files).filter((p) => !outZip.files[p].dir);
  console.log(`Output archive:   ${outPaths.length} files`);

  const missing = origPaths.filter((p) => !outPaths.includes(p));
  const added = outPaths.filter((p) => !origPaths.includes(p));
  if (missing.length) {
    console.log(`\nMISSING (${missing.length}):`);
    for (const p of missing) console.log(`  - ${p}`);
  } else {
    console.log(`\nNo missing parts.`);
  }
  if (added.length) {
    console.log(`\nADDED (${added.length}):`);
    for (const p of added) console.log(`  + ${p}`);
  }

  console.log(`\nIntegrity:`);
  console.log(`  sheetCountMatch:     ${integrityReport.sheetCountMatch}`);
  console.log(`  writtenCellsVerified: ${integrityReport.writtenCellsVerified}`);
  console.log(`  errors:   ${integrityReport.errors.length ? "\n    " + integrityReport.errors.join("\n    ") : "none"}`);
  console.log(`  warnings: ${integrityReport.warnings.length ? "\n    " + integrityReport.warnings.join("\n    ") : "none"}`);

  // Spot-check unchanged parts — an arbitrary chart file should be byte-identical.
  const sample = origPaths.find((p) => p.startsWith("xl/charts/chart"));
  if (sample) {
    const a = await origZip.file(sample)!.async("uint8array");
    const b = await outZip.file(sample)?.async("uint8array");
    if (!b) {
      console.log(`\n${sample}: MISSING in output`);
    } else if (a.length !== b.length) {
      console.log(`\n${sample}: size drift ${a.length} -> ${b.length}`);
    } else {
      let same = true;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          same = false;
          break;
        }
      }
      console.log(`\n${sample}: byte-identical = ${same}`);
    }
  }

  const ok =
    missing.length === 0 &&
    integrityReport.errors.length === 0 &&
    integrityReport.writtenCellsVerified;
  console.log(`\n${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
