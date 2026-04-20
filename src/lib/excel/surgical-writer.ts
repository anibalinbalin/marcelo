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
 * Formula handling: an earlier version of this writer skipped any cell that
 * held a formula, on the theory that overwriting a formula with a literal
 * would desync calcChain.xml. That was wrong for Camila's templates: in
 * LREN3's PROJ sheet (and similar projection-style models), the current-
 * quarter column ships as a forward-projection formula that an analyst is
 * expected to paste over with the reported actual. Skipping it produced
 * "41/41 written" reports while the target cells stayed on stale projected
 * values. We now force-overwrite formula cells, handling shared-formula
 * masters by promoting their first surviving clone before the master is
 * demoted to a literal.
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

function columnLetterToNumber(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

function addressFromRowCol(row: number, col: number): string {
  return `${columnNumberToLetter(col)}${row}`;
}

function splitAddress(addr: string): { col: string; row: number } {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`invalid cell address: ${addr}`);
  return { col: m[1], row: parseInt(m[2], 10) };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Shared-formula helpers ───────────────────────────────────────────────────

/**
 * Enumerate every cell address in a shared-formula ref range. Supports
 * col-only and row-only spans; rejects rectangular spans (we haven't seen
 * a rectangular shared formula in Camila's templates yet).
 */
function enumerateRange(startAddr: string, endAddr: string): string[] {
  const a = splitAddress(startAddr);
  const b = splitAddress(endAddr);
  const aCol = columnLetterToNumber(a.col);
  const bCol = columnLetterToNumber(b.col);
  if (a.col === b.col) {
    const out: string[] = [];
    for (let r = a.row; r <= b.row; r++) out.push(`${a.col}${r}`);
    return out;
  }
  if (a.row === b.row) {
    const out: string[] = [];
    for (let c = aCol; c <= bCol; c++) out.push(`${columnNumberToLetter(c)}${a.row}`);
    return out;
  }
  throw new Error(`rectangular shared-formula ref not supported: ${startAddr}:${endAddr}`);
}

/**
 * Shift every unquoted, non-absolute cell reference in a formula expression
 * by (colDelta, rowDelta). Skips function-name-like tokens that are
 * immediately followed by `(` (e.g. LOG10(), ATAN2()) and skips absolute
 * columns (`$CL25`).
 *
 * Tested against the shapes observed in LREN3 PROJ shared masters:
 *   "CL225", "+CL128-CL91-...-CL102", "+CK99", "FAT!CL3"
 */
function shiftFormula(expr: string, colDelta: number, rowDelta: number): string {
  return expr.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)(\(?)/g,
    (match, absCol, col, absRow, row, openParen) => {
      if (openParen) return match; // function call like LOG10(
      const newCol = absCol ? col : columnNumberToLetter(columnLetterToNumber(col) + colDelta);
      const newRow = absRow ? row : String(parseInt(row, 10) + rowDelta);
      return `${absCol}${newCol}${absRow}${newRow}`;
    },
  );
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
  const relIterator = workbookRelsXml.matchAll(
    /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g,
  );
  for (const rm of relIterator) {
    relIdToTarget.set(rm[1], rm[2]);
  }

  const sheets = new Map<string, string>();
  const sheetIterator = workbookXml.matchAll(
    /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g,
  );
  for (const sm of sheetIterator) {
    const name = sm[1];
    const rid = sm[2];
    const target = relIdToTarget.get(rid);
    if (!target) continue;
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

// ── Cell locator ─────────────────────────────────────────────────────────────

interface CellMatch {
  addr: string;
  full: string;       // entire <c ...> ... </c> (or self-closed) substring
  index: number;      // position of `full` in the parent xml
  attrs: string;      // raw attribute text inside the opening tag
  selfClosing: boolean;
  inner: string;      // content between > and </c> (empty for self-closing)
}

function findCell(xml: string, addr: string): CellMatch | null {
  const re = new RegExp(
    `<c\\b([^>]*?\\br="${escapeRegex(addr)}"[^>]*?)(/>|>([\\s\\S]*?)</c>)`,
  );
  const m = xml.match(re);
  if (!m || m.index === undefined) return null;
  return {
    addr,
    full: m[0],
    index: m.index,
    attrs: m[1],
    selfClosing: m[2] === "/>",
    inner: m[2] === "/>" ? "" : m[3] ?? "",
  };
}

function stylePreserve(attrs: string): string {
  const m = attrs.match(/\bs="(\d+)"/);
  return m ? ` s="${m[1]}"` : "";
}

function buildLiteralCell(addr: string, value: number, attrs: string): string {
  return `<c r="${addr}"${stylePreserve(attrs)}><v>${value}</v></c>`;
}

function replaceCellAddress(node: string, fromAddr: string, toAddr: string): string {
  return node.replace(
    new RegExp(`\\br="${escapeRegex(fromAddr)}"`),
    `r="${toAddr}"`,
  );
}

// ── Formula element parsing ──────────────────────────────────────────────────

interface FormulaInfo {
  full: string;
  selfClosing: boolean;
  attrs: string;
  body: string;
  type?: string;
  si?: string;
  ref?: string;
}

function parseFormula(inner: string): FormulaInfo | null {
  const m = inner.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
  if (!m) return null;
  const attrs = m[1];
  const selfClosing = m[0].endsWith("/>");
  const body = selfClosing ? "" : (m[2] ?? "");
  const typeM = attrs.match(/\bt="([^"]+)"/);
  const siM = attrs.match(/\bsi="([^"]+)"/);
  const refM = attrs.match(/\bref="([^"]+)"/);
  return {
    full: m[0],
    selfClosing,
    attrs,
    body,
    type: typeM ? typeM[1] : undefined,
    si: siM ? siM[1] : undefined,
    ref: refM ? refM[1] : undefined,
  };
}

interface SharedFormulaMaster {
  addr: string;
  body: string;
}

function buildSharedFormulaMasterMap(sheetXml: string): Map<string, SharedFormulaMaster> {
  const masters = new Map<string, SharedFormulaMaster>();
  const cellIter = sheetXml.matchAll(/<c\b([^>]*?\br="([A-Z]+\d+)"[^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g);
  for (const match of cellIter) {
    const addr = match[2];
    const inner = match[3] ?? "";
    if (!inner.includes("<f")) continue;
    const formula = parseFormula(inner);
    if (!formula || formula.type !== "shared" || !formula.si || !formula.body) continue;
    masters.set(formula.si, { addr, body: formula.body });
  }
  return masters;
}

function buildStandaloneFormulaCell(
  addr: string,
  attrs: string,
  formulaBody: string,
): string {
  return `<c r="${addr}"${stylePreserve(attrs)}><f>${formulaBody}</f></c>`;
}

function cloneCellToAddress(
  cell: CellMatch,
  targetAddr: string,
  sharedMasters: Map<string, SharedFormulaMaster>,
): string {
  if (cell.selfClosing || !cell.inner.includes("<f")) {
    return replaceCellAddress(cell.full, cell.addr, targetAddr);
  }

  const formula = parseFormula(cell.inner);
  if (!formula) {
    return replaceCellAddress(cell.full, cell.addr, targetAddr);
  }

  let formulaBody = formula.body;
  if (!formulaBody && formula.type === "shared" && formula.si) {
    const master = sharedMasters.get(formula.si);
    if (master) {
      const sourceParts = splitAddress(cell.addr);
      const masterParts = splitAddress(master.addr);
      const colDelta =
        columnLetterToNumber(sourceParts.col) - columnLetterToNumber(masterParts.col);
      const rowDelta = sourceParts.row - masterParts.row;
      formulaBody = shiftFormula(master.body, colDelta, rowDelta);
    }
  }

  if (!formulaBody) {
    return replaceCellAddress(cell.full, cell.addr, targetAddr);
  }

  const sourceParts = splitAddress(cell.addr);
  const targetParts = splitAddress(targetAddr);
  const colDelta =
    columnLetterToNumber(targetParts.col) - columnLetterToNumber(sourceParts.col);
  const rowDelta = targetParts.row - sourceParts.row;
  const shiftedBody = shiftFormula(formulaBody, colDelta, rowDelta);
  return buildStandaloneFormulaCell(targetAddr, cell.attrs, shiftedBody);
}

function replaceOrInsertCell(xml: string, addr: string, newNode: string): string {
  const existing = findCell(xml, addr);
  if (existing) {
    return xml.slice(0, existing.index) + newNode + xml.slice(existing.index + existing.full.length);
  }
  return insertCellNode(xml, addr, newNode);
}

function clonePreviousColumn(
  sheetXml: string,
  targetCol: number,
): string {
  if (targetCol <= 1) return sheetXml;

  const sourceCol = columnNumberToLetter(targetCol - 1);
  const targetColLetter = columnNumberToLetter(targetCol);
  const sharedMasters = buildSharedFormulaMasterMap(sheetXml);
  const sourceCellRe = new RegExp(
    `<c\\b([^>]*?\\br="(${escapeRegex(sourceCol)}\\d+)"[^>]*)(/>|>([\\s\\S]*?)</c>)`,
    "g",
  );

  let xml = sheetXml;
  const sourceCells = Array.from(xml.matchAll(sourceCellRe)).map((match) => ({
    addr: match[2],
    full: match[0],
    index: match.index ?? 0,
    attrs: match[1],
    selfClosing: match[3] === "/>",
    inner: match[3] === "/>" ? "" : (match[4] ?? ""),
  })) as CellMatch[];

  for (const cell of sourceCells) {
    const { row } = splitAddress(cell.addr);
    const targetAddr = `${targetColLetter}${row}`;
    if (findCell(xml, targetAddr)) {
      continue;
    }
    const cloned = cloneCellToAddress(cell, targetAddr, sharedMasters);
    xml = replaceOrInsertCell(xml, targetAddr, cloned);
  }

  return xml;
}

// ── Per-sheet rewrite ────────────────────────────────────────────────────────

interface SheetPatchResult {
  xml: string;
  errors: string[];
  demoted: Set<string>;
}

function patchSheet(
  sheetXml: string,
  sheetName: string,
  writes: CellWrite[],
): SheetPatchResult {
  const errors: string[] = [];
  const demoted = new Set<string>();
  let xml = sheetXml;

  const writeAddrSet = new Set(writes.map(w => addressFromRowCol(w.row, w.col)));

  for (const w of writes) {
    const addr = addressFromRowCol(w.row, w.col);
    try {
      const next = rewriteOne(xml, sheetName, addr, w.value, writeAddrSet, demoted);
      if (next.error) errors.push(next.error);
      else xml = next.xml;
    } catch (e) {
      errors.push(`${sheetName}!${addr}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { xml, errors, demoted };
}

interface RewriteResult {
  xml: string;
  error?: string;
}

function rewriteOne(
  xml: string,
  sheetName: string,
  addr: string,
  value: number,
  writeAddrSet: Set<string>,
  demoted: Set<string>,
): RewriteResult {
  const cell = findCell(xml, addr);

  if (!cell) {
    return { xml: insertNewCell(xml, addr, value) };
  }

  if (cell.selfClosing || !/<f\b/.test(cell.inner)) {
    // Plain value cell, shared-string cell, or empty placeholder — simple
    // overwrite. Dropping `t="..."` is intentional — a number should not be
    // a shared-string reference.
    const newNode = buildLiteralCell(addr, value, cell.attrs);
    return { xml: xml.slice(0, cell.index) + newNode + xml.slice(cell.index + cell.full.length) };
  }

  const f = parseFormula(cell.inner);
  if (!f) {
    return { xml, error: `${sheetName}!${addr}: could not parse <f> element` };
  }
  if (f.type === "array") {
    return {
      xml,
      error: `${sheetName}!${addr}: array formulas not supported (strip manually or remap)`,
    };
  }

  // Shared-formula master with a multi-cell ref: promote a surviving clone
  // before demoting this cell, so dependents keep their formula.
  if (f.type === "shared" && f.ref && f.ref.includes(":")) {
    const [rangeStart, rangeEnd] = f.ref.split(":");
    if (rangeStart !== addr) {
      return {
        xml,
        error: `${sheetName}!${addr}: shared master ref ${f.ref} doesn't start at master`,
      };
    }
    let rangeCells: string[];
    try {
      rangeCells = enumerateRange(rangeStart, rangeEnd);
    } catch (e) {
      return {
        xml,
        error: `${sheetName}!${addr}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const cloneAddrs = rangeCells.slice(1);
    // A "true orphan clone" carries <f t="shared" si="X"/> pointing at THIS
    // master. Cells inside the ref range that hold their own standalone
    // formula (e.g. CM89 = `<f>-CM130</f>`) are NOT clones of si=X in
    // Excel's eyes — they just happen to live inside the rectangle. Skip
    // them; they need no promotion. Same for cells we're about to write.
    const orphanClones = cloneAddrs.filter(a => {
      if (writeAddrSet.has(a)) return false;
      const c = findCell(xml, a);
      if (!c || c.selfClosing) return false;
      const cf = parseFormula(c.inner);
      if (!cf) return false;
      return cf.type === "shared" && cf.si === f.si;
    });

    let nextXml = xml;

    if (orphanClones.length > 0) {
      // Orphan clones must be contiguous to fold into one new master range.
      // If a non-orphan cell (own formula) sits between them, we'd need two
      // masters — hard-error rather than silently lose formulas.
      const firstIdx = cloneAddrs.indexOf(orphanClones[0]);
      const lastIdx = cloneAddrs.indexOf(orphanClones[orphanClones.length - 1]);
      if (lastIdx - firstIdx + 1 !== orphanClones.length) {
        return {
          xml,
          error: `${sheetName}!${addr}: orphan clones for si=${f.si} are non-contiguous (${orphanClones.join(",")})`,
        };
      }
      const newMasterAddr = orphanClones[0];
      const lastClone = orphanClones[orphanClones.length - 1];
      const newRef = newMasterAddr === lastClone ? newMasterAddr : `${newMasterAddr}:${lastClone}`;

      const oldParts = splitAddress(addr);
      const newParts = splitAddress(newMasterAddr);
      const colDelta = columnLetterToNumber(newParts.col) - columnLetterToNumber(oldParts.col);
      const rowDelta = newParts.row - oldParts.row;
      const shiftedBody = shiftFormula(f.body, colDelta, rowDelta);

      const promoted = promoteSharedClone(
        nextXml,
        newMasterAddr,
        f.si ?? "",
        newRef,
        shiftedBody,
      );
      if (!promoted) {
        return {
          xml,
          error: `${sheetName}!${addr}: failed to promote clone ${newMasterAddr} for si=${f.si}`,
        };
      }
      nextXml = promoted;
    }

    const masterNow = findCell(nextXml, addr);
    if (!masterNow) {
      return { xml, error: `${sheetName}!${addr}: master vanished during promotion` };
    }
    const newMasterCellNode = buildLiteralCell(addr, value, masterNow.attrs);
    const rewritten =
      nextXml.slice(0, masterNow.index) +
      newMasterCellNode +
      nextXml.slice(masterNow.index + masterNow.full.length);
    demoted.add(addr);
    return { xml: rewritten };
  }

  // Plain formula, shared clone, or degenerate shared master (single-cell
  // ref, no clones). Strip the <f> and emit a literal cell.
  const newNode = buildLiteralCell(addr, value, cell.attrs);
  demoted.add(addr);
  return { xml: xml.slice(0, cell.index) + newNode + xml.slice(cell.index + cell.full.length) };
}

/**
 * Rewrite a shared-formula clone cell so it becomes the new master for its
 * `si` group. Replaces `<f t="shared" si="N"/>` with
 * `<f t="shared" ref="NEW_REF" si="N">SHIFTED_BODY</f>`, preserving the
 * rest of the cell (style, cached `<v>` value).
 */
function promoteSharedClone(
  xml: string,
  addr: string,
  si: string,
  newRef: string,
  shiftedBody: string,
): string | null {
  const cell = findCell(xml, addr);
  if (!cell || cell.selfClosing) return null;
  const fRe = /<f\b[^>]*?\bt="shared"[^>]*?(?:\/>|><\/f>)/;
  if (!fRe.test(cell.inner)) return null;
  const newF = `<f t="shared" ref="${newRef}" si="${si}">${shiftedBody}</f>`;
  const newInner = cell.inner.replace(fRe, newF);
  const openingTagEnd = cell.full.indexOf(">") + 1;
  const openingTag = cell.full.slice(0, openingTagEnd);
  const closingTag = "</c>";
  const newCell = openingTag + newInner + closingTag;
  return xml.slice(0, cell.index) + newCell + xml.slice(cell.index + cell.full.length);
}

// ── Cell insertion (for addresses that don't yet exist) ──────────────────────

function insertNewCell(xml: string, addr: string, value: number): string {
  return insertCellNode(xml, addr, `<c r="${addr}"><v>${value}</v></c>`);
}

function insertCellNode(xml: string, addr: string, newCell: string): string {
  const rowNum = parseInt(addr.match(/\d+$/)?.[0] ?? "0", 10);
  if (!rowNum) throw new Error(`Could not parse row number from ${addr}`);
  const rowRe = new RegExp(
    `<row\\b([^>]*?\\br="${rowNum}"[^>]*?)(/>|>([\\s\\S]*?)</row>)`,
  );
  const rowMatch = xml.match(rowRe);

  if (rowMatch) {
    const rowAttrs = rowMatch[1];
    const rowSelfClosing = rowMatch[2] === "/>";
    const rowInner = rowSelfClosing ? "" : (rowMatch[3] ?? "");
    const targetCol = addr.match(/^[A-Z]+/)?.[0] ?? "";
    let insertAt = rowInner.length;
    const cellIter = rowInner.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g);
    for (const cm of cellIter) {
      const existingCol = cm[1].match(/^[A-Z]+/)?.[0] ?? "";
      if (compareCol(existingCol, targetCol) > 0) {
        insertAt = cm.index ?? insertAt;
        break;
      }
    }
    const newRowInner = rowInner.slice(0, insertAt) + newCell + rowInner.slice(insertAt);
    const newRowTag = `<row${rowAttrs}>${newRowInner}</row>`;
    return xml.replace(rowRe, newRowTag);
  }

  const newRow = `<row r="${rowNum}">${newCell}</row>`;
  const sheetDataRe = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/;
  const sdMatch = xml.match(sheetDataRe);
  if (!sdMatch) throw new Error(`<sheetData> not found — cannot insert ${addr}`);
  const sdInner = sdMatch[1];
  let insertAt = sdInner.length;
  const rowIter = sdInner.matchAll(/<row\b[^>]*\br="(\d+)"/g);
  for (const rm of rowIter) {
    if (parseInt(rm[1], 10) > rowNum) {
      insertAt = rm.index ?? insertAt;
      break;
    }
  }
  const newSdInner = sdInner.slice(0, insertAt) + newRow + sdInner.slice(insertAt);
  return xml.replace(sheetDataRe, `<sheetData>${newSdInner}</sheetData>`);
}

function compareCol(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Workbook calcPr ──────────────────────────────────────────────────────────

function setFullCalcOnLoad(workbookXml: string): string {
  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)\/>/, (_, attrs) => {
      const stripped = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${stripped} fullCalcOnLoad="1"/>`;
    });
  }
  if (/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)>/, (_, attrs) => {
      const stripped = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${stripped} fullCalcOnLoad="1">`;
    });
  }
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

  const originalFormulaCounts: Record<string, number> = {};
  const outputFormulaCounts: Record<string, number> = {};
  for (const [sheetName, path] of sheetMap) {
    const f = zip.file(path);
    if (!f) continue;
    const xml = await f.async("string");
    originalFormulaCounts[sheetName] = countFormulasInSheet(xml);
  }

  const pathToSheet = new Map<string, string>();
  for (const [name, path] of sheetMap) pathToSheet.set(path, name);

  let anyDemoted = false;

  for (const [path, writes] of writesBySheetPath) {
    const f = zip.file(path);
    if (!f) {
      errors.push(`Worksheet file ${path} missing from archive`);
      continue;
    }
    let xml = await f.async("string");
    const sheetName = pathToSheet.get(path) ?? path;
    const targetCols = [...new Set(writes.map((write) => write.col))].sort((a, b) => a - b);
    for (const targetCol of targetCols) {
      xml = clonePreviousColumn(xml, targetCol);
    }
    const res = patchSheet(xml, sheetName, writes);
    for (const err of res.errors) errors.push(err);
    if (res.demoted.size > 0) anyDemoted = true;
    zip.file(path, res.xml);
  }

  // Force recalculation on open so any surviving dependent formulas recompute
  // from the new literal inputs we just wrote.
  const patchedWorkbookXml = setFullCalcOnLoad(workbookXml);
  zip.file("xl/workbook.xml", patchedWorkbookXml);

  // Defensive calcChain cleanup — templates we've seen don't ship one, but
  // if one does, strip it so Excel rebuilds on open instead of trusting
  // stale entries that may point at cells we just demoted.
  if (anyDemoted && zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const rels = zip.file("xl/_rels/workbook.xml.rels");
    if (rels) {
      const relsText = await rels.async("string");
      const newRels = relsText.replace(
        /<Relationship\b[^>]*Type="[^"]*calcChain[^"]*"[^>]*\/>/g,
        "",
      );
      zip.file("xl/_rels/workbook.xml.rels", newRels);
    }
    const ct = zip.file("[Content_Types].xml");
    if (ct) {
      const ctText = await ct.async("string");
      const newCt = ctText.replace(
        /<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g,
        "",
      );
      zip.file("[Content_Types].xml", newCt);
    }
  }

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
    for (const w of writes) {
      const addr = addressFromRowCol(w.row, w.col);
      const cellRe = new RegExp(
        `<c\\b[^>]*\\br="${escapeRegex(addr)}"[^>]*>\\s*<v>([^<]+)</v>\\s*</c>`,
      );
      const m = xml.match(cellRe);
      if (!m) {
        errors.push(`Cell ${sheetName}!${addr}: not found in output (expected literal ${w.value})`);
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
    // Formula count drift is expected now — we intentionally demote formula
    // cells to literals. Surface as a warning, not an error.
    if (orig !== out) {
      warnings.push(`Formula count in "${sheetName}": ${orig} -> ${out}`);
    }
  }

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
