// lumina-feed · 隐藏窗打印原始 PDF（O2）
// 不打印主窗口 chrome；将 PDF 字节/本地路径载入独立 BrowserWindow 后 webContents.print。
import { BrowserWindow, ipcMain, shell, type WebContents } from "electron";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_PDF_BYTES = 400 * 1024 * 1024;
const LOAD_MS = 45_000;
const PRINT_MS = 5 * 60_000;

export type PrintPageRange = { from: number; to: number };

export type PrintPdfPayload = {
  bytes?: ArrayBuffer | Uint8Array | Buffer | number[];
  filePath?: string;
  pageRanges?: PrintPageRange[];
  title?: string;
  silent?: boolean;
  deviceName?: string;
  landscape?: boolean;
  dryRun?: boolean;
};

export type PrintPdfResult = {
  ok: boolean;
  reason?: string;
  printed?: boolean;
  dryRun?: boolean;
  fallback?: string;
  printWindowUrl?: string;
  mainWindowUrl?: string;
  isPdfDocument?: boolean;
  printWindowIsMain?: boolean;
  cleaned?: boolean;
};

function toUint8(raw: unknown): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return raw;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) return new Uint8Array(raw);
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  if (Array.isArray(raw)) return Uint8Array.from(raw);
  const obj = raw as { type?: string; data?: number[] };
  if (obj && obj.type === "Buffer" && Array.isArray(obj.data)) return Uint8Array.from(obj.data);
  return null;
}

function isPdfMagic(bytes: Uint8Array): boolean {
  if (!bytes || bytes.byteLength < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function sanitizeRanges(ranges: unknown, maxHint?: number): PrintPageRange[] {
  if (!Array.isArray(ranges)) return [];
  const out: PrintPageRange[] = [];
  for (const r of ranges) {
    if (!r || typeof r !== "object") continue;
    let from = Math.floor(Number((r as PrintPageRange).from));
    let to = Math.floor(Number((r as PrintPageRange).to));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < 1) continue;
    if (from > to) { const t = from; from = to; to = t; }
    if (maxHint && from > maxHint) continue;
    if (maxHint) to = Math.min(to, maxHint);
    out.push({ from, to });
  }
  return out;
}

function looksLikePdfPath(p: string): boolean {
  return /\.pdf$/i.test(String(p || "").trim());
}

async function resolvePdfBytes(payload: PrintPdfPayload): Promise<{ bytes: Uint8Array; sourcePath?: string }> {
  const filePath = typeof payload.filePath === "string" ? payload.filePath.trim() : "";
  if (filePath) {
    if (!path.isAbsolute(filePath)) throw new Error("path_not_absolute");
    const bytes = await readFile(filePath);
    if (!isPdfMagic(bytes)) throw new Error("not_pdf");
    if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("too_large");
    return { bytes, sourcePath: filePath };
  }
  const bytes = toUint8(payload.bytes);
  if (!bytes || !bytes.byteLength) throw new Error("no_pdf");
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("too_large");
  if (!isPdfMagic(bytes)) throw new Error("not_pdf");
  return { bytes };
}

function isPrintablePdfUrl(url: string): boolean {
  const u = String(url || "");
  return /\.pdf($|\?|#)/i.test(u) || /^chrome-extension:\/\//i.test(u);
}

async function waitPdfUrl(win: BrowserWindow, timeoutMs: number): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (win.isDestroyed()) throw new Error("destroyed");
    const url = win.webContents.getURL();
    if (isPrintablePdfUrl(url)) return url;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("load_timeout");
}

function printContents(wc: WebContents, opts: PrintPdfPayload, ranges: PrintPageRange[]): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "print_timeout" }), PRINT_MS);
    const printOpts: Electron.WebContentsPrintOptions = {
      silent: !!opts.silent,
      printBackground: false,
      landscape: !!opts.landscape,
      copies: 1,
    };
    if (opts.deviceName) printOpts.deviceName = String(opts.deviceName);
    if (ranges.length) printOpts.pageRanges = ranges;
    try {
      wc.print(printOpts, (success, failureReason) => {
        clearTimeout(timer);
        if (success) resolve({ ok: true });
        else {
          const why = String(failureReason || "print_failed");
          if (/cancel/i.test(why)) resolve({ ok: false, reason: "canceled" });
          else resolve({ ok: false, reason: why });
        }
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({ ok: false, reason: String((err as Error)?.message || err) });
    }
  });
}

async function printPdfFromPayload(payload: PrintPdfPayload, parent: BrowserWindow | null): Promise<PrintPdfResult> {
  const mainUrl = parent && !parent.isDestroyed() ? parent.webContents.getURL() : "";
  const { bytes, sourcePath } = await resolvePdfBytes(payload || {});
  const ranges = sanitizeRanges(payload.pageRanges);

  const dir = await mkdtemp(path.join(tmpdir(), "lumina-print-"));
  const tmpPath = path.join(dir, "doc-" + randomBytes(4).toString("hex") + ".pdf");
  await writeFile(tmpPath, bytes);

  let win: BrowserWindow | null = null;
  let keepTemp = false;
  try {
    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 1100,
      x: -12000,
      y: -12000,
      frame: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      title: String(payload.title || "Lumina Print").slice(0, 180),
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        javascript: true,
        webSecurity: true,
      },
    });
    win.setMenuBarVisibility(false);
    try {
      await win.loadURL(pathToFileURL(tmpPath).href);
    } catch {
      /* PDF 插件偶发以异常结束 loadURL，仍以 URL 为准 */
    }
    const printUrl = await waitPdfUrl(win, LOAD_MS);
    await new Promise((r) => setTimeout(r, 300));

    const printWindowIsMain = !!(parent && printUrl && mainUrl && printUrl === mainUrl);
    const isPdf = !printWindowIsMain && (isPrintablePdfUrl(printUrl) || looksLikePdfPath(tmpPath));

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        printWindowUrl: printUrl,
        mainWindowUrl: mainUrl,
        isPdfDocument: isPdf,
        printWindowIsMain,
        cleaned: false,
      };
    }

    if (printWindowIsMain) {
      return { ok: false, reason: "refused_main_window", printWindowUrl: printUrl, mainWindowUrl: mainUrl };
    }

    try {
      win.setOpacity(0);
      if (!win.isVisible()) win.showInactive();
    } catch { /* ignore */ }

    const printed = await printContents(win.webContents, payload, ranges);
    if (printed.ok) {
      return { ok: true, printed: true, printWindowUrl: printUrl, isPdfDocument: true, printWindowIsMain: false };
    }
    if (printed.reason === "canceled") {
      return { ok: false, reason: "canceled", printWindowUrl: printUrl };
    }

    keepTemp = true;
    const openErr = await shell.openPath(sourcePath && looksLikePdfPath(sourcePath) ? sourcePath : tmpPath);
    if (openErr) return { ok: false, reason: printed.reason || openErr, fallback: "os_reader_failed" };
    return {
      ok: true,
      printed: false,
      fallback: "os_reader",
      reason: printed.reason,
      printWindowUrl: printUrl,
    };
  } finally {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
    if (!keepTemp) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
    } else {
      setTimeout(() => { unlink(tmpPath).catch(() => {}); }, 10 * 60_000);
    }
  }
}

export function registerPrintPdf(): void {
  ipcMain.handle("reader:printPdf", async (event, payload: PrintPdfPayload) => {
    try {
      const parent = BrowserWindow.fromWebContents(event.sender);
      return await printPdfFromPayload(payload || {}, parent);
    } catch (err) {
      return { ok: false, reason: String((err as Error)?.message || err) } as PrintPdfResult;
    }
  });
}
