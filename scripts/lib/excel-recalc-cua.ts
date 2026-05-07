/**
 * Force Microsoft Excel to open an xlsx, recalculate, read a list of
 * cells from one sheet, and close without saving.
 *
 * Replaces the osascript version (excel-recalc.ts) with Cua Driver.
 * Proven on 2026-05-07 against LREN3 4Q25 / CENT 4Q25.
 *
 * Improvements over osascript:
 *  - No blind `delay 2` — polls status bar AXStaticText for "Ready"
 *  - Handles alert dialogs (Enable Editing, Update Links) via AX tree
 *  - Reads values from Formula Bar via AX — no pt-BR locale trap
 *
 * macOS 14.x note: hotkey/type_text/press_key crash on SkyLight
 * SLSEventAuthenticationMessage. All interaction uses set_value (pure AX)
 * + click with action:"confirm" (pure AX). No CGEvent path needed.
 *
 * Spaces note: `osascript activate` is used once to bring Excel to the
 * current Space. This is unavoidable — get_window_state requires the
 * window to be on-screen. Everything else is pure Cua Driver.
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve as resolvePath, isAbsolute } from "node:path";

const execFileP = promisify(execFile);

const CELL_REF_RE = /^[A-Z]{1,3}\d+$/;
const SHEET_NAME_RE = /^[A-Za-z0-9 _-]{1,31}$/;

const CUA = process.env.CUA_DRIVER_PATH ?? "/Users/anibalin/.local/bin/cua-driver";

// ---------------------------------------------------------------------------
// Cua Driver CLI wrapper
// stdin MUST be 'ignore' or cua-driver hangs waiting for piped JSON.
// ---------------------------------------------------------------------------

function cua(tool: string, params: Record<string, unknown> = {}): Promise<any> {
  const args = ["call", tool];
  if (Object.keys(params).length > 0) {
    args.push(JSON.stringify(params));
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(CUA, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`cua ${tool} exit ${code}: ${err.trim() || out.slice(0, 200)}`));
        return;
      }
      try { resolve(JSON.parse(out)); }
      catch { resolve({ raw: out.trim() }); }
    });
    proc.on("error", reject);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Ensure daemon is running (needed for TCC context on macOS 14+)
// ---------------------------------------------------------------------------

async function ensureDaemon(): Promise<void> {
  try {
    await execFileP(CUA, ["status"], { timeout: 5000 });
  } catch {
    await execFileP(CUA, ["serve"], { timeout: 10_000 }).catch(() => {});
    await sleep(3000);
  }
}

// ---------------------------------------------------------------------------
// AX helpers
// ---------------------------------------------------------------------------

const NAME_BOX_IDX = 4; // AXComboBox "name box" — stable across Excel versions

async function snapshot(pid: number, windowId: number): Promise<string> {
  try {
    const data = await cua("get_window_state", { pid, window_id: windowId });
    return data.tree_markdown ?? "";
  } catch {
    return "";
  }
}

async function setNameBoxAndConfirm(pid: number, windowId: number, value: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const tree = await snapshot(pid, windowId);
    if (tree.includes("NameBox")) break;
    await sleep(1000);
  }
  await cua("set_value", { pid, window_id: windowId, element_index: NAME_BOX_IDX, value });
  for (let i = 0; i < 3; i++) {
    const tree = await snapshot(pid, windowId);
    if (tree.includes("NameBox")) break;
    await sleep(1000);
  }
  await cua("click", { pid, window_id: windowId, element_index: NAME_BOX_IDX, action: "confirm" });
  await sleep(300);
}

function parseFormulaBar(tree: string): string | null {
  const match = tree.match(/Formula Bar\.\s*[A-Z]+,\d+\s*(.*?)\)\s*id=XLFormulaEditor/);
  if (!match) return null;
  return match[1].trim() || null;
}

// ---------------------------------------------------------------------------
// Wait for "Ready" in status bar (replaces blind `delay 2`)
// ---------------------------------------------------------------------------

async function waitForReady(pid: number, windowId: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tree = await snapshot(pid, windowId);
    if (tree.includes('"Ready"') || tree.includes("In Ready mode")) return;
    if (tree === "") {
      await sleep(2000);
      continue;
    }
    await sleep(500);
  }
  throw new Error(`Excel did not reach Ready state within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Dismiss alert dialogs
// ---------------------------------------------------------------------------

type DialogResult =
  | { kind: "none" }
  | { kind: "benign"; label: string }
  | { kind: "repair"; tree: string };

function classifyDialog(tree: string): DialogResult {
  if (!tree.includes("alert")) return { kind: "none" };
  const repairPatterns = [
    "found a problem",
    "recover",
    "repair",
    "unreadable content",
    "significant loss",
  ];
  const lower = tree.toLowerCase();
  for (const p of repairPatterns) {
    if (lower.includes(p)) return { kind: "repair", tree };
  }
  return { kind: "benign", label: tree.match(/AXStaticText "([^"]+)"/)?.[1] ?? "unknown" };
}

async function dismissDialogs(pid: number, windowId: number): Promise<void> {
  const tree = await snapshot(pid, windowId);
  const dialog = classifyDialog(tree);
  if (dialog.kind === "none") return;

  const yesMatch = tree.match(/\[(\d+)\] AXButton "Yes"/);
  if (yesMatch) {
    try {
      await cua("click", { pid, window_id: windowId, element_index: Number(yesMatch[1]), action: "press" });
    } catch {
      await cua("click", { pid, x: 480, y: 420 });
    }
    await sleep(1500);
    return;
  }

  if (tree.includes("Enable Editing")) {
    const match = tree.match(/\[(\d+)\].*Enable Editing/);
    if (match) {
      try {
        await cua("click", { pid, window_id: windowId, element_index: Number(match[1]), action: "press" });
      } catch {
        await cua("click", { pid, x: 700, y: 150 });
      }
      await sleep(1500);
    }
  }
}

// ---------------------------------------------------------------------------
// Read a single cell via Name Box + Formula Bar
// ---------------------------------------------------------------------------

async function readCell(pid: number, windowId: number, cellRef: string): Promise<number | null> {
  await setNameBoxAndConfirm(pid, windowId, cellRef);
  const tree = await snapshot(pid, windowId);
  const raw = parseFormulaBar(tree);
  if (raw === null || raw === "" || raw === "missing value") return null;
  const normalized = raw.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacement for recalcAndRead()
// ---------------------------------------------------------------------------

export interface RecalcOptions {
  settleSeconds?: number;
}

export async function recalcAndRead(
  filePath: string,
  sheet: string,
  cells: readonly string[],
  _opts: RecalcOptions = {},
): Promise<Record<string, number | null>> {
  if (!isAbsolute(filePath)) {
    throw new Error(`recalcAndRead: filePath must be absolute, got "${filePath}"`);
  }
  const absPath = resolvePath(filePath);
  if (!SHEET_NAME_RE.test(sheet)) {
    throw new Error(`recalcAndRead: invalid sheet name "${sheet}"`);
  }
  for (const c of cells) {
    if (!CELL_REF_RE.test(c)) {
      throw new Error(`recalcAndRead: invalid cell ref "${c}"`);
    }
  }

  await ensureDaemon();

  // 1. Open file and bring to current Space
  await execFileP("open", [absPath], { timeout: 10_000 });
  await sleep(3000);
  await execFileP("osascript", ["-e", 'tell application "Microsoft Excel" to activate'], { timeout: 5000 }).catch(() => {});

  // 2. Find Excel PID (retry — cold launch takes 10-15s)
  let pid = 0;
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const { apps } = await cua("list_apps");
    const excel = apps?.find((a: any) => a.bundle_id === "com.microsoft.Excel" && a.running);
    if (excel?.pid) { pid = excel.pid; break; }
  }
  if (!pid) throw new Error("Microsoft Excel not running after open");

  // Re-activate after launch finishes (ensures window is on current Space)
  await execFileP("osascript", ["-e", 'tell application "Microsoft Excel" to activate'], { timeout: 5000 }).catch(() => {});
  await sleep(2000);

  // 3. Find workbook window (retry — file may still be loading)
  const fileName = absPath.split("/").pop()?.replace(/\.xlsx?$/i, "") ?? "";
  let windowId = 0;
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    const { windows } = await cua("list_windows", { pid });
    const wb = windows?.find((w: any) => w.title?.includes(fileName) && w.is_on_screen);
    if (wb) { windowId = wb.window_id; break; }
    const any = windows?.find((w: any) => w.title && w.is_on_screen && !w.title.includes("Open new"));
    if (any) { windowId = any.window_id; break; }
  }
  if (!windowId) throw new Error(`No on-screen Excel window matching "${fileName}"`);

  // 4. Dismiss alert dialogs
  await dismissDialogs(pid, windowId);

  // 5. Wait for Ready state
  await waitForReady(pid, windowId);

  // 6. Read cells — sheet-qualify the first one to switch sheets
  const result: Record<string, number | null> = {};
  for (let i = 0; i < cells.length; i++) {
    const ref = i === 0 ? `'${sheet}'!${cells[i]}` : cells[i];
    result[cells[i]] = await readCell(pid, windowId, ref);
  }

  // 7. Close without saving via File > Close menu
  try { await closeWithoutSaving(pid, windowId); } catch { /* best-effort close */ }

  return result;
}

// ---------------------------------------------------------------------------
// Close without saving (shared by recalcAndRead and verifyWorkbookOpens)
// ---------------------------------------------------------------------------

async function closeWithoutSaving(pid: number, windowId: number): Promise<void> {
  const tree = await snapshot(pid, windowId);
  const fileMenu = tree.match(/\[(\d+)\] AXMenuBarItem "File"/);
  if (fileMenu) {
    await cua("click", { pid, window_id: windowId, element_index: Number(fileMenu[1]), action: "pick" });
    await sleep(500);
    const menuTree = await snapshot(pid, windowId);
    const closeItem = menuTree.match(/\[(\d+)\] AXMenuItem "Close"/);
    if (closeItem) {
      await cua("click", { pid, window_id: windowId, element_index: Number(closeItem[1]), action: "press" });
      await sleep(800);
      const dlg = await snapshot(pid, windowId);
      const dontSave = dlg.match(/\[(\d+)\] AXButton "Don't Save"/);
      if (dontSave) {
        await cua("click", { pid, window_id: windowId, element_index: Number(dontSave[1]), action: "press" });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — verify an xlsx opens in Excel without repair prompts
// ---------------------------------------------------------------------------

export interface VerifyResult {
  ok: boolean;
  error?: string;
  sentinels?: Record<string, number | null>;
}

export async function verifyWorkbookOpens(
  filePath: string,
  sentinels?: { sheet: string; cells: readonly string[] },
): Promise<VerifyResult> {
  if (!isAbsolute(filePath)) {
    throw new Error(`verifyWorkbookOpens: filePath must be absolute, got "${filePath}"`);
  }
  const absPath = resolvePath(filePath);

  await ensureDaemon();

  // 1. Open file
  await execFileP("open", [absPath], { timeout: 10_000 });
  await sleep(3000);
  await execFileP("osascript", ["-e", 'tell application "Microsoft Excel" to activate'], { timeout: 5000 }).catch(() => {});

  // 2. Find Excel PID
  let pid = 0;
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const { apps } = await cua("list_apps");
    const excel = apps?.find((a: any) => a.bundle_id === "com.microsoft.Excel" && a.running);
    if (excel?.pid) { pid = excel.pid; break; }
  }
  if (!pid) return { ok: false, error: "Microsoft Excel not running after open" };

  await execFileP("osascript", ["-e", 'tell application "Microsoft Excel" to activate'], { timeout: 5000 }).catch(() => {});
  await sleep(2000);

  // 3. Find workbook window
  const fileName = absPath.split("/").pop()?.replace(/\.xlsx?$/i, "") ?? "";
  let windowId = 0;
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    const { windows } = await cua("list_windows", { pid });
    const wb = windows?.find((w: any) => w.title?.includes(fileName) && w.is_on_screen);
    if (wb) { windowId = wb.window_id; break; }
    const any = windows?.find((w: any) => w.title && w.is_on_screen && !w.title.includes("Open new"));
    if (any) { windowId = any.window_id; break; }
  }
  if (!windowId) {
    return { ok: false, error: `No on-screen Excel window matching "${fileName}"` };
  }

  // 4. Check for repair dialog — this is the gate
  await sleep(2000);
  const tree = await snapshot(pid, windowId);
  const dialog = classifyDialog(tree);

  if (dialog.kind === "repair") {
    // Close without saving even on failure — don't leave Excel in a bad state
    try {
      const noBtn = tree.match(/\[(\d+)\] AXButton "No"/);
      if (noBtn) {
        await cua("click", { pid, window_id: windowId, element_index: Number(noBtn[1]), action: "press" });
        await sleep(1000);
      }
      await closeWithoutSaving(pid, windowId);
    } catch { /* best-effort */ }
    return { ok: false, error: "Excel repair dialog detected — workbook is corrupt" };
  }

  // 5. Dismiss benign dialogs (Update Links, Enable Editing)
  if (dialog.kind === "benign") {
    await dismissDialogs(pid, windowId);
  }

  // 6. Wait for Ready
  try {
    await waitForReady(pid, windowId);
  } catch (e) {
    try { await closeWithoutSaving(pid, windowId); } catch { /* */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 7. Read sentinel cells if requested
  let sentinelValues: Record<string, number | null> | undefined;
  if (sentinels && sentinels.cells.length > 0) {
    sentinelValues = {};
    for (let i = 0; i < sentinels.cells.length; i++) {
      const ref = i === 0 ? `'${sentinels.sheet}'!${sentinels.cells[i]}` : sentinels.cells[i];
      sentinelValues[sentinels.cells[i]] = await readCell(pid, windowId, ref);
    }
  }

  // 8. Close without saving
  try { await closeWithoutSaving(pid, windowId); } catch { /* best-effort */ }

  return { ok: true, sentinels: sentinelValues };
}
