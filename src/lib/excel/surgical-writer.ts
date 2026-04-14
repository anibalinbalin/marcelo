/**
 * Surgical xlsx writer — patches target cells in the template archive without
 * round-tripping through ExcelJS.
 *
 * Why: ExcelJS's load/writeBuffer cycle drops parts it doesn't understand —
 * charts, chartEx, external links, rich data, printer settings, metadata,
 * persons — and Excel then prompts "We found a problem with some content,
 * do you want us to try to recover". This writer opens the .xlsx as a ZIP,
 * rewrites just the affected sheet XML nodes via targeted regex patches, and
 * re-emits the archive byte-for-byte elsewhere.
 *
 * Strategy:
 *   1. Load the buffer with JSZip.
 *   2. Parse xl/workbook.xml + xl/_rels/workbook.xml.rels to map sheet name
 *      to the worksheet zip path.
 *   3. For each write, find `<c r="ADDR" ...>` in the sheet XML and replace
 *      its contents with `<v>VALUE</v>`. Handle 5 cell shapes (self-closing,
 *      plain value, shared string, standalone formula, shared formula clone).
 *      Insert the cell if it doesn't exist yet.
 *   4. Shared formula MASTERS are rejected — overwriting them without
 *      rewriting the clone chain would silently break dependent cells.
 *   5. Set fullCalcOnLoad in workbook.xml so Excel recalculates on open.
 *   6. Generate the output buffer with DEFLATE compression.
 *   7. Re-read each written cell in the output and verify the `<v>` child
 *      matches the expected number.
 */
import JSZip from "jszip";

export interface CellWrite {
  sheet: string;
  row: number;
  col: number;
  value: number;
}

export interface IntegrityReport {
  sheetCountMatch: boolean;
  formulaCountMatch: Record<string, { original: number; output: number; match: boolean }>;
  writtenCellsVerified: boolean;
  errors: string[];
  warnings: string[];
}

// ── Address helpers ──────────────────────────────────────────────────────────

function columnNumberToLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function addressFromRowCol(row: number, col: number): string {
  return `${columnNumberToLetter(col)}${row}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Workbook / rels parsing ──────────────────────────────────────────────────

/**
 * Returns a map of sheet name to worksheet zip path (e.g. "xl/worksheets/sheet5.xml").
 */
function parseWorkbookSheets(
  workbookXml: string,
  workbookRelsXml: string,
): Map<string, string> {
  const relIdToTarget = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(workbookRelsXml)) !== null) {
    relIdToTarget.set(rm[1], rm[2]);
  }

  const sheets = new Map<string, string>();
  const sheetRe = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sheetRe.exec(workbookXml)) !== null) {
    const name = sm[1];
    const rid = sm[2];
    const target = relIdToTarget.get(rid);
    if (!target) continue;
    // Targets are relative to xl/, e.g. "worksheets/sheet5.xml"
    const normalized = target.startsWith("/")
      ? target.replace(/^\/+/, "")
      : `xl/${target}`;
    sheets.set(name, normalized);
  }
  return sheets;
}

function countFormulasInSheet(sheetXml: string): number {
  const m = sheetXml.match(/<f\b/g);
  return m ? m.length : 0;
}

// ── Cell patching ────────────────────────────────────────────────────────────

interface PatchResult {
  xml: string;
  error?: string;
  skipped?: string;
}

function buildCellNode(addr: string, value: number, styleAttr: string): string {
  return `<c r="${addr}"${styleAttr}><v>${value}</v></c>`;
}

/**
 * Replace or insert a single cell in a worksheet XML string.
 *
 * Handles the cell shapes we see in Camila's templates:
 *   - Self-closing placeholder: <c r="C3" s="363"/>
 *   - Plain value:              <c r="C3" s="363"><v>123</v></c>
 *   - Shared string:            <c r="C3" t="s"><v>7</v></c>
 *   - Standalone formula:       <c r="C3"><f>A1+B1</f><v>42</v></c>
 *   - Shared formula clone:     <c r="C3"><f t="shared" si="0"/></c>  (safe)
 *   - Shared formula, no clones: <c r="C3"><f t="shared" ref="C3" si="0">A1+B1</f>...</c>  (safe — no clones to orphan)
 *   - Shared formula master:    <c r="C3"><f t="shared" ref="C3:C10" si="0">A1+B1</f>...</c>  (REJECTED — has clones)
 *
 * For all accepted shapes the result becomes:
 *   <c r="ADDR" {preserved-style}><v>VALUE</v></c>
 *
 * Dropping `t="s"` is intentional — a number should not be a shared-string
 * reference. Dropping `t="shared" si="N"` on a clone is intentional — we
 * only strip the clone's formula, never the master's.
 */
function patchCellInSheet(
  sheetXml: string,
  addr: string,
  value: number,
): PatchResult {
  const addrRe = new RegExp(
    `<c\\b([^>]*?\\br="${escapeRegex(addr)}"[^>]*?)(/>|>([\\s\\S]*?)</c>)`,
  );
  const match = sheetXml.match(addrRe);

  if (match) {
    const attrs = match[1];
    const selfClosing = match[2] === "/>";
    const inner = selfClosing ? "" : (match[3] ?? "");

    // Skip formula cells. Overwriting a formula with a literal desynchronizes
    // calcChain.xml and (in CENT's case) produces a file Excel flags as
    // corrupt. The right architectural behavior is: let the formula stay,
    // let fullCalcOnLoad recompute from its inputs on first open. If the
    // pipeline is writing both a total (BO9 = Net Revenue) and its inputs
    // (BO5, BO8), the formula will produce the correct total automatically.
    // If a mapping targets a formula cell with no corresponding input
    // writes, the cached stale value remains until recalc — that is a
    // mapping bug that should be surfaced at the mapping layer, not
    // papered over by blindly overwriting formulas.
    if (!selfClosing && /<f\b/.test(inner)) {
      return {
        xml: sheetXml,
        skipped: `Cell ${addr} is a formula — skipped; formula will recompute on open`,
      };
    }

    // Preserve the style attribute if present; drop t="..." and r="..."
    // since we're rebuilding the tag.
    const styleMatch = attrs.match(/\bs="(\d+)"/);
    const styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : "";
    const newNode = buildCellNode(addr, value, styleAttr);
    return { xml: sheetXml.replace(addrRe, newNode) };
  }

  // Cell doesn't exist — insert it into the right row, creating the row if
  // needed. Keep rows sorted by row number and cells sorted by column.
  const rowNum = parseInt(addr.match(/\d+$/)?.[0] ?? "0", 10);
  if (!rowNum) {
    return { xml: sheetXml, error: `Could not parse row number from ${addr}` };
  }

  const newCell = buildCellNode(addr, value, "");
  const rowRe = new RegExp(
    `<row\\b([^>]*?\\br="${rowNum}"[^>]*?)(/>|>([\\s\\S]*?)</row>)`,
  );
  const rowMatch = sheetXml.match(rowRe);

  if (rowMatch) {
    const rowAttrs = rowMatch[1];
    const rowSelfClosing = rowMatch[2] === "/>";
    const rowInner = rowSelfClosing ? "" : (rowMatch[3] ?? "");
    // Insert the cell in column order. Scan existing <c r="..."> tags, find
    // the first one whose column sorts after addr, and insert before it.
    const cellRe = /<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g;
    const targetCol = addr.match(/^[A-Z]+/)?.[0] ?? "";
    let insertAt = rowInner.length;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowInner)) !== null) {
      const existingCol = cm[1].match(/^[A-Z]+/)?.[0] ?? "";
      if (compareCol(existingCol, targetCol) > 0) {
        insertAt = cm.index;
        break;
      }
    }
    const newRowInner =
      rowInner.slice(0, insertAt) + newCell + rowInner.slice(insertAt);
    const newRowTag = `<row${rowAttrs}>${newRowInner}</row>`;
    return { xml: sheetXml.replace(rowRe, newRowTag) };
  }

  // Row doesn't exist — insert a new <row> into <sheetData> in row order.
  const newRow = `<row r="${rowNum}">${newCell}</row>`;
  const sheetDataRe = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/;
  const sdMatch = sheetXml.match(sheetDataRe);
  if (!sdMatch) {
    return { xml: sheetXml, error: `<sheetData> not found — cannot insert ${addr}` };
  }
  const sdInner = sdMatch[1];
  const rowScanRe = /<row\b[^>]*\br="(\d+)"/g;
  let insertAt = sdInner.length;
  let rm: RegExpExecArray | null;
  while ((rm = rowScanRe.exec(sdInner)) !== null) {
    if (parseInt(rm[1], 10) > rowNum) {
      insertAt = rm.index;
      break;
    }
  }
  const newSdInner =
    sdInner.slice(0, insertAt) + newRow + sdInner.slice(insertAt);
  const newSheetXml = sheetXml.replace(
    sheetDataRe,
    `<sheetData>${newSdInner}</sheetData>`,
  );
  return { xml: newSheetXml };
}

function compareCol(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Workbook calcPr ──────────────────────────────────────────────────────────

function setFullCalcOnLoad(workbookXml: string): string {
  // Case 1: <calcPr .../>  (self-closing)
  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)\/>/, (_, attrs) => {
      const stripped = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${stripped} fullCalcOnLoad="1"/>`;
    });
  }
  // Case 2: <calcPr ...>...</calcPr>
  if (/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)>/, (_, attrs) => {
      const stripped = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${stripped} fullCalcOnLoad="1">`;
    });
  }
  // Case 3: no calcPr — inject one before </workbook>
  return workbookXml.replace(
    /<\/workbook>/,
    `<calcPr fullCalcOnLoad="1"/></workbook>`,
  );
}

// ── Main entry ───────────────────────────────────────────────────────────────

export async function writeBlueValues(
  templateBuffer: Buffer,
  valuesToWrite: CellWrite[],
): Promise<{ buffer: Buffer; integrityReport: IntegrityReport }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const zip = await JSZip.loadAsync(templateBuffer);

  const workbookFile = zip.file("xl/workbook.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relsFile) {
    throw new Error("Template is missing xl/workbook.xml or its rels");
  }
  const workbookXml = await workbookFile.async("string");
  const relsXml = await relsFile.async("string");
  const sheetMap = parseWorkbookSheets(workbookXml, relsXml);
  const originalSheetCount = sheetMap.size;

  // Group writes by sheet path so we only load+save each sheet XML once.
  const writesBySheetPath = new Map<string, CellWrite[]>();
  for (const w of valuesToWrite) {
    const path = sheetMap.get(w.sheet);
    if (!path) {
      errors.push(`Sheet "${w.sheet}" not found in workbook`);
      continue;
    }
    const list = writesBySheetPath.get(path);
    if (list) list.push(w);
    else writesBySheetPath.set(path, [w]);
  }

  // Apply patches + track formula counts per sheet name.
  const originalFormulaCounts: Record<string, number> = {};
  const outputFormulaCounts: Record<string, number> = {};
  // Pre-count formulas on ALL sheets so the integrity report matches the
  // old writer's shape (one entry per sheet, not just edited sheets).
  for (const [sheetName, path] of sheetMap) {
    const f = zip.file(path);
    if (!f) continue;
    const xml = await f.async("string");
    originalFormulaCounts[sheetName] = countFormulasInSheet(xml);
  }

  // Reverse lookup: path -> sheet name
  const pathToSheet = new Map<string, string>();
  for (const [name, path] of sheetMap) pathToSheet.set(path, name);

  // Addresses we intentionally skipped (e.g. formula cells). Tracked per
  // sheet path so post-write verification doesn't flag them as missing.
  const skippedBySheetPath = new Map<string, Set<string>>();

  for (const [path, writes] of writesBySheetPath) {
    const f = zip.file(path);
    if (!f) {
      errors.push(`Worksheet file ${path} missing from archive`);
      continue;
    }
    let xml = await f.async("string");
    const skipped = new Set<string>();
    for (const w of writes) {
      const addr = addressFromRowCol(w.row, w.col);
      const res = patchCellInSheet(xml, addr, w.value);
      if (res.error) {
        errors.push(`${pathToSheet.get(path)}!${addr}: ${res.error}`);
        continue;
      }
      if (res.skipped) {
        warnings.push(`${pathToSheet.get(path)}!${addr}: ${res.skipped}`);
        skipped.add(addr);
        continue;
      }
      xml = res.xml;
    }
    skippedBySheetPath.set(path, skipped);
    zip.file(path, xml);
  }

  // Force recalculation on open so formula cells (which we never overwrite
  // — see patchCellInSheet) render with fresh results from any new literal
  // inputs we wrote. calcChain.xml is intentionally left untouched: Excel
  // strictly validates its entries against the sheet XML, and since we
  // never remove formulas, every calcChain entry still points at a real
  // formula cell. Emptying or rewriting calcChain produces a "We found a
  // problem with some content" recovery prompt in Excel for Mac.
  const patchedWorkbookXml = setFullCalcOnLoad(workbookXml);
  zip.file("xl/workbook.xml", patchedWorkbookXml);

  // Emit the archive.
  const outputBuffer = (await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })) as Buffer;

  // Verify each write landed correctly by re-reading the output archive.
  const zip2 = await JSZip.loadAsync(outputBuffer);
  let allVerified = errors.length === 0;
  for (const [path, writes] of writesBySheetPath) {
    const f = zip2.file(path);
    if (!f) {
      errors.push(`Output missing worksheet ${path}`);
      allVerified = false;
      continue;
    }
    const xml = await f.async("string");
    const sheetName = pathToSheet.get(path) ?? path;
    outputFormulaCounts[sheetName] = countFormulasInSheet(xml);
    const skipped = skippedBySheetPath.get(path) ?? new Set<string>();
    for (const w of writes) {
      const addr = addressFromRowCol(w.row, w.col);
      if (skipped.has(addr)) continue;
      const cellRe = new RegExp(
        `<c\\b[^>]*\\br="${escapeRegex(addr)}"[^>]*>\\s*<v>([^<]+)</v>\\s*</c>`,
      );
      const m = xml.match(cellRe);
      if (!m) {
        errors.push(`Cell ${sheetName}!${addr}: not found in output`);
        allVerified = false;
        continue;
      }
      const got = parseFloat(m[1]);
      if (got !== w.value) {
        errors.push(`Cell ${sheetName}!${addr}: expected ${w.value}, got ${got}`);
        allVerified = false;
      }
    }
  }

  // Fill in formula counts for sheets we didn't touch.
  for (const [sheetName, path] of sheetMap) {
    if (sheetName in outputFormulaCounts) continue;
    const f = zip2.file(path);
    if (!f) continue;
    const xml = await f.async("string");
    outputFormulaCounts[sheetName] = countFormulasInSheet(xml);
  }

  const formulaCountMatch: Record<
    string,
    { original: number; output: number; match: boolean }
  > = {};
  for (const sheetName of Object.keys(originalFormulaCounts)) {
    const orig = originalFormulaCounts[sheetName];
    const out = outputFormulaCounts[sheetName] ?? 0;
    formulaCountMatch[sheetName] = {
      original: orig,
      output: out,
      match: orig === out,
    };
    if (orig !== out) {
      warnings.push(`Formula count in "${sheetName}": ${orig} -> ${out}`);
    }
  }

  // Re-parse the output workbook for sheet count verification.
  const wb2File = zip2.file("xl/workbook.xml");
  const rels2File = zip2.file("xl/_rels/workbook.xml.rels");
  let outputSheetCount = originalSheetCount;
  if (wb2File && rels2File) {
    const wb2Xml = await wb2File.async("string");
    const rels2Xml = await rels2File.async("string");
    outputSheetCount = parseWorkbookSheets(wb2Xml, rels2Xml).size;
  }

  return {
    buffer: outputBuffer,
    integrityReport: {
      sheetCountMatch: originalSheetCount === outputSheetCount,
      formulaCountMatch,
      writtenCellsVerified: allVerified,
      errors,
      warnings,
    },
  };
}
