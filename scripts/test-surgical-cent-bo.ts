/**
 * Verify the surgical writer handles CENT's degenerate shared formulas
 * (ref="BO9" with no clone range). Previously rejected; should now succeed.
 */
import * as fs from "fs";
import { writeBlueValues, type CellWrite } from "../src/lib/excel/surgical-writer";

async function main() {
  const buf = fs.readFileSync("/tmp/CENT_4Q25_orig.xlsx");
  const writes: CellWrite[] = [
    { sheet: "PROJ", row: 9, col: 67, value: 9999.99 },   // BO9
    { sheet: "PROJ", row: 19, col: 67, value: 8888.88 },  // BO19
    { sheet: "PROJ", row: 20, col: 67, value: -7777.77 }, // BO20
  ];
  const { buffer, integrityReport } = await writeBlueValues(buf, writes);
  fs.writeFileSync("/tmp/CENT_4Q25_bo_test.xlsx", buffer);

  console.log("errors:  ", integrityReport.errors);
  console.log("warnings:", integrityReport.warnings);
  console.log("verified:", integrityReport.writtenCellsVerified);

  if (integrityReport.errors.length === 0 && integrityReport.writtenCellsVerified) {
    console.log("PASS — BO9/BO19/BO20 written successfully");
    process.exit(0);
  }
  console.log("FAIL");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
