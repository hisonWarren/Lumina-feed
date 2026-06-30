// lumina-feed · 文献资产 IPC 辅助（取文后 ingest · FTS · 队列 · reconcile）
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, type WebContents } from "electron";
import type { Store } from "../src/core/store/index.ts";
import type { Paper } from "../src/core/model.ts";
import { loadAppSettings } from "./settings.ts";
import { extractText } from "../src/core/oa/pdf-extract.ts";
import {
  deleteFetchLog,
  ensurePaperAssetTables,
  getFetchLog,
  libraryAdd,
  libraryHas,
  listFetchLogs,
  recordFetchLog,
  recordLibraryDetach,
  clearLibraryDetach,
  isLibraryDetached,
  type FetchContext,
  type PaperAssetSnapshot,
} from "../src/core/store/paper-asset.ts";
import {
  sha256Hex,
  paperIdFromContentHash,
  titleFromFilename,
  IMPORT_PROVENANCE,
  importMapHashKey,
  importMapPathKey,
} from "../src/core/store/local-import.ts";
import { migrateDocKeys } from "../src/core/store/doc-migrate.ts";
import { normalizeLocalPath, recordReadingOpen } from "../src/core/reader/reading-history.ts";
import { readerDocKeyCandidates } from "../src/core/reader/doc-key.ts";

export interface PaperAssetDeps {
  store: Store;
  pdfPath: (id: string) => string;
  pdfDir: () => string;
  ftsPrep: (text: string) => string;
  ensureLib: () => void;
  ensureFts: () => void;
}

export function ensureStubPaper(deps: PaperAssetDeps, paperId: string, title?: string): void {
  if (deps.store.papers.getById(paperId)) return;
  const now = new Date().toISOString();
  const stub: Paper = {
    id: paperId,
    title: title || paperId,
    authors: [],
    studyTypes: ["other"],
    source: "local",
    isPreprint: false,
    peerReviewed: false,
    retracted: false,
    versions: [],
    ingestedAt: now,
  };
  deps.store.papers.upsert(stub);
}

/** 防止 paperId 路径穿越（pdf:delete / readPdf）。DOI 型 id 含 `/`，落盘时用 encodeURIComponent，此处勿拒斜杠。 */
export function assertSafePaperId(paperId: string, pdfDirFn: () => string): void {
  if (!paperId || typeof paperId !== "string") throw new Error("invalid paperId");
  if (/[\0\r\n]/.test(paperId) || paperId.includes("..")) {
    throw new Error("invalid paperId");
  }
  const base = path.resolve(pdfDirFn());
  const resolved = path.resolve(path.join(base, encodeURIComponent(paperId) + ".pdf"));
  if (!resolved.startsWith(base + path.sep) && resolved !== base) throw new Error("invalid paperId");
}

export function broadcastPapersChanged(payload: Record<string, unknown> = {}): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try { w.webContents.send("papers:changed", payload); } catch { /* ignore */ }
    }
  }
}

export async function indexPdfFulltext(deps: PaperAssetDeps, paperId: string, bytes: Uint8Array): Promise<void> {
  try {
    const text = await extractText(bytes);
    if (!text || text.replace(/\s+/g, "").length < 400) return;
    deps.ensureFts();
    deps.store.db.prepare("DELETE FROM fulltext_fts WHERE paper_id=?").run(paperId);
    deps.store.db.prepare("INSERT INTO fulltext_fts(paper_id, body) VALUES(?,?)")
      .run(paperId, deps.ftsPrep(String(text).slice(0, 2000000)));
  } catch { /* 索引失败不阻断取文 */ }
}

export async function postFetchSuccess(
  deps: PaperAssetDeps,
  paperId: string,
  source: string,
  ctx: FetchContext,
): Promise<void> {
  recordFetchLog(deps.store.db, paperId, source, ctx);
  const settings = await loadAppSettings(deps.store);
  const autoIngest = settings.autoIngestOnFetch !== false;
  if (autoIngest) {
    deps.ensureLib();
    ensureStubPaper(deps, paperId);
    libraryAdd(deps.store.db, paperId, ctx.provenance || "find_fetch", !libraryHas(deps.store.db, paperId));
  }
  void (async () => {
    try {
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(deps.pdfPath(paperId));
      await indexPdfFulltext(deps, paperId, new Uint8Array(buf));
    } catch { /* 全文索引后台执行，不阻塞取文返回 */ }
  })();
  broadcastPapersChanged({ paperId, action: "fetched", source });
}

export function buildAssetSnapshot(deps: PaperAssetDeps, paperId: string): PaperAssetSnapshot {
  let hasPdf = false;
  try { hasPdf = fs.existsSync(deps.pdfPath(paperId)); } catch { /* ignore */ }
  const log = getFetchLog(deps.store.db, paperId);
  let provenance: string | null = null;
  let inLibrary = false;
  try {
    deps.ensureLib();
    const row = deps.store.db.prepare("SELECT provenance FROM library WHERE paper_id=?").get(paperId) as { provenance?: string } | undefined;
    if (row) { inLibrary = true; provenance = row.provenance ?? null; }
  } catch { /* ignore */ }
  return {
    paperId,
    hasPdf,
    inLibrary,
    provenance,
    fetchSource: log?.source ?? null,
    fetchedAt: log?.fetched_at ?? null,
    channel: log?.channel ?? null,
  };
}

export function hydrateAssets(deps: PaperAssetDeps): Record<string, PaperAssetSnapshot> {
  ensurePaperAssetTables(deps.store.db);
  const out: Record<string, PaperAssetSnapshot> = {};
  const seen = new Set<string>();
  for (const log of listFetchLogs(deps.store.db)) {
    seen.add(log.paper_id);
    out[log.paper_id] = buildAssetSnapshot(deps, log.paper_id);
  }
  try {
    for (const f of fs.readdirSync(deps.pdfDir())) {
      if (!f.endsWith(".pdf")) continue;
      const id = decodeURIComponent(f.slice(0, -4));
      if (!seen.has(id)) out[id] = buildAssetSnapshot(deps, id);
    }
  } catch { /* ignore */ }
  return out;
}

export async function reconcileOrphans(deps: PaperAssetDeps): Promise<{ added: number }> {
  ensurePaperAssetTables(deps.store.db);
  deps.ensureLib();
  const settings = await loadAppSettings(deps.store);
  let added = 0;
  try {
    for (const f of fs.readdirSync(deps.pdfDir())) {
      if (!f.endsWith(".pdf")) continue;
      const paperId = decodeURIComponent(f.slice(0, -4));
      if (!getFetchLog(deps.store.db, paperId)) {
        recordFetchLog(deps.store.db, paperId, "cached", { channel: "recovered", provenance: "recovered" });
      }
      if (settings.autoIngestOnFetch !== false && !libraryHas(deps.store.db, paperId) && !isLibraryDetached(deps.store.db, paperId)) {
        ensureStubPaper(deps, paperId);
        libraryAdd(deps.store.db, paperId, "recovered", true);
        added++;
      }
    }
  } catch { /* ignore */ }
  if (added > 0) broadcastPapersChanged({ action: "reconcile", added });
  return { added };
}

export function deleteLocalPdf(deps: PaperAssetDeps, paperId: string, removeFromLibrary: boolean): boolean {
  try {
    assertSafePaperId(paperId, deps.pdfDir);
    const p = deps.pdfPath(paperId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { return false; }
  deleteFetchLog(deps.store.db, paperId);
  clearLibraryDetach(deps.store.db, paperId);
  try {
    deps.ensureFts();
    deps.store.db.prepare("DELETE FROM fulltext_fts WHERE paper_id=?").run(paperId);
  } catch { /* ignore */ }
  if (removeFromLibrary) {
    try {
      deps.ensureLib();
      deps.store.db.prepare("DELETE FROM library WHERE paper_id=?").run(paperId);
    } catch { /* ignore */ }
  }
  broadcastPapersChanged({ paperId, action: "pdf_deleted", removeFromLibrary });
  return true;
}

export interface DetachedPdfItem {
  paperId: string;
  bytes: number;
  title?: string;
  detachedAt?: string | null;
}

/** 磁盘上有 PDF、但不在工作集中的条目（含用户主动「移除」保留的 PDF）。 */
export function listDetachedPdfs(deps: PaperAssetDeps): DetachedPdfItem[] {
  ensurePaperAssetTables(deps.store.db);
  deps.ensureLib();
  const out: DetachedPdfItem[] = [];
  try {
    const detachRows = deps.store.db.prepare("SELECT paper_id, detached_at FROM library_detach_log").all() as { paper_id: string; detached_at: string }[];
    const detachMap = new Map(detachRows.map((r) => [r.paper_id, r.detached_at]));
    for (const f of fs.readdirSync(deps.pdfDir())) {
      if (!f.endsWith(".pdf")) continue;
      const paperId = decodeURIComponent(f.slice(0, -4));
      if (libraryHas(deps.store.db, paperId)) continue;
      let bytes = 0;
      try { bytes = fs.statSync(path.join(deps.pdfDir(), f)).size; } catch { /* ignore */ }
      const paper = deps.store.papers.getById(paperId);
      out.push({
        paperId,
        bytes,
        title: paper?.title,
        detachedAt: detachMap.get(paperId) ?? null,
      });
    }
    out.sort((a, b) => b.bytes - a.bytes);
  } catch { /* ignore */ }
  return out;
}

/** 删除未收藏 PDF（默认全部；可传 paperIds 选择性清理）。 */
export function pruneDetachedPdfs(deps: PaperAssetDeps, paperIds?: string[]): { removed: number; freedBytes: number } {
  const targets = new Set(
    (paperIds?.length ? paperIds : listDetachedPdfs(deps).map((x) => x.paperId)),
  );
  let removed = 0;
  let freedBytes = 0;
  for (const paperId of targets) {
    if (libraryHas(deps.store.db, paperId)) continue;
    let size = 0;
    try { size = fs.statSync(deps.pdfPath(paperId)).size; } catch { /* ignore */ }
    if (deleteLocalPdf(deps, paperId, false)) {
      removed++;
      freedBytes += size;
    }
  }
  if (removed > 0) broadcastPapersChanged({ action: "prune_detached", removed, freedBytes });
  return { removed, freedBytes };
}

export function detachFromLibrary(deps: PaperAssetDeps, paperId: string): boolean {
  try {
    deps.ensureLib();
    deps.store.db.prepare("DELETE FROM library WHERE paper_id=?").run(paperId);
    recordLibraryDetach(deps.store.db, paperId);
    broadcastPapersChanged({ paperId, action: "library_detached" });
    return true;
  } catch {
    return false;
  }
}

export interface ImportLocalPdfOpts {
  bytes: Uint8Array;
  title?: string;
  localPath?: string;
  /** 导入前阅读器使用的 docKey 列表，用于合并 AI/批注缓存 */
  fromDocKeys?: string[];
  /** 为 false 时仅落盘+建条目，不写入 library 表 */
  addToLibrary?: boolean;
}

export interface ImportLocalPdfResult {
  ok: boolean;
  paperId?: string;
  contentHash?: string;
  title?: string;
  existed?: boolean;
  inLibrary?: boolean;
  error?: string;
}

function ensureImportMapTable(deps: PaperAssetDeps): void {
  deps.store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
}

function saveImportMap(deps: PaperAssetDeps, hash: string, paperId: string, localPath?: string): void {
  ensureImportMapTable(deps);
  const now = new Date().toISOString();
  const ins = deps.store.db.prepare(
    "INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
  );
  ins.run(importMapHashKey(hash), JSON.stringify({ paperId }), now);
  if (localPath) {
    ins.run(importMapPathKey(normalizeLocalPath(localPath)), JSON.stringify({ paperId, hash }), now);
  }
}

export function lookupImportedPaperId(
  deps: PaperAssetDeps,
  opts: { contentHash?: string; localPath?: string },
): string | null {
  ensureImportMapTable(deps);
  try {
    if (opts.contentHash) {
      const r = deps.store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(importMapHashKey(opts.contentHash)) as { payload?: string } | undefined;
      if (r?.payload) {
        const p = JSON.parse(r.payload) as { paperId?: string };
        if (p.paperId) return p.paperId;
      }
    }
    if (opts.localPath) {
      const r = deps.store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(importMapPathKey(normalizeLocalPath(opts.localPath))) as { payload?: string } | undefined;
      if (r?.payload) {
        const p = JSON.parse(r.payload) as { paperId?: string };
        if (p.paperId) return p.paperId;
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function guessTitleFromPdf(bytes: Uint8Array, fallback: string): Promise<string> {
  try {
    const text = await extractText(bytes);
    const line = String(text || "").split(/\n/).map((s) => s.trim()).find((s) => s.length > 12);
    if (line && line.length <= 240) return line;
  } catch { /* ignore */ }
  return fallback;
}

/** 本地 PDF 复制进应用目录、建 paper 条目、入库，并合并阅读缓存。 */
export async function importLocalPdfToLibrary(
  deps: PaperAssetDeps,
  opts: ImportLocalPdfOpts,
): Promise<ImportLocalPdfResult> {
  try {
    const bytes = opts.bytes;
    if (!bytes?.byteLength) return { ok: false, error: "empty_pdf" };
    const hash = sha256Hex(bytes);
    let paperId = lookupImportedPaperId(deps, { contentHash: hash, localPath: opts.localPath });
    let existed = false;
    if (!paperId) {
      paperId = paperIdFromContentHash(hash);
    } else {
      existed = true;
    }
    assertSafePaperId(paperId, deps.pdfDir);
    const dest = deps.pdfPath(paperId);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, Buffer.from(bytes));
    } else {
      existed = true;
    }
    const fallbackTitle = titleFromFilename(opts.title || opts.localPath || "document.pdf");
    const title = await guessTitleFromPdf(bytes, fallbackTitle);
    ensureStubPaper(deps, paperId, title);
    const existing = deps.store.papers.getById(paperId);
    if (existing && existing.title === paperId && title !== paperId) {
      deps.store.papers.upsert({ ...existing, title });
    }
    if (!getFetchLog(deps.store.db, paperId)) {
      recordFetchLog(deps.store.db, paperId, "import", { channel: "import", provenance: IMPORT_PROVENANCE });
    }
    saveImportMap(deps, hash, paperId, opts.localPath);
    const toKey = `paper:${paperId}`;
    const fromKeys = [
      ...(opts.fromDocKeys || []),
      ...readerDocKeyCandidates({
        contentHash: hash,
        localPath: opts.localPath,
        name: opts.title,
        data: bytes,
      }),
    ];
    migrateDocKeys(deps.store.db, fromKeys, toKey);
    const addToLibrary = opts.addToLibrary !== false;
    let inLibrary = libraryHas(deps.store.db, paperId);
    if (addToLibrary && !inLibrary) {
      deps.ensureLib();
      libraryAdd(deps.store.db, paperId, IMPORT_PROVENANCE, true);
      inLibrary = true;
    }
    void indexPdfFulltext(deps, paperId, bytes);
    if (opts.localPath) {
      recordReadingOpen(deps.store.db, { paperId, title, page: 1 });
    }
    broadcastPapersChanged({ paperId, action: existed ? "import_existing" : "imported", source: "import" });
    return { ok: true, paperId, contentHash: hash, title, existed, inLibrary };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "import_failed" };
  }
}

export function fingerprintPdfBytes(bytes: Uint8Array): { contentHash: string; paperId: string } {
  const hash = sha256Hex(bytes);
  return { contentHash: hash, paperId: paperIdFromContentHash(hash) };
}

// ── 取文队列（检索进行中降为 1 路并行，避免与多源检索抢主进程）──
type QueueJob = { paperId: string; ctx: FetchContext; sender?: WebContents; priority: number };
type FetchRunner = (paperId: string, onTrace: ((ev: unknown) => void) | undefined, ctx: FetchContext) => Promise<unknown>;

const fetchQueue: QueueJob[] = [];
let fetchActive = 0;
const FETCH_CONCURRENCY_IDLE = 2;
const FETCH_CONCURRENCY_SEARCH = 1;
let searchInflightGetter: () => number = () => 0;

export function setSearchInflightGetter(fn: () => number): void {
  searchInflightGetter = fn;
}

function fetchConcurrencyLimit(): number {
  return searchInflightGetter() > 0 ? FETCH_CONCURRENCY_SEARCH : FETCH_CONCURRENCY_IDLE;
}

function insertFetchJob(job: QueueJob): void {
  const dup = fetchQueue.findIndex((q) => q.paperId === job.paperId);
  if (dup >= 0) {
    const ex = fetchQueue[dup];
    if (job.priority < ex.priority) ex.priority = job.priority;
    if (job.ctx?.channel === "manual") ex.ctx = { ...ex.ctx, ...job.ctx };
    return;
  }
  const idx = fetchQueue.findIndex((q) => q.priority > job.priority);
  if (idx === -1) fetchQueue.push(job);
  else fetchQueue.splice(idx, 0, job);
}

let boundRunFetch: FetchRunner | null = null;

export function bindFetchRunner(runFetch: FetchRunner): void {
  boundRunFetch = runFetch;
}

export function resumeFetchQueue(): void {
  if (boundRunFetch) void drainFetchQueue(boundRunFetch);
}

export function enqueueFetch(
  jobs: Array<{ paperId: string; ctx?: FetchContext; priority?: number }>,
  sender: WebContents | undefined,
  runFetch: FetchRunner,
): { queued: number } {
  for (const j of jobs) {
    insertFetchJob({
      paperId: j.paperId,
      ctx: j.ctx || {},
      sender,
      priority: typeof j.priority === "number" ? j.priority : 2,
    });
  }
  void drainFetchQueue(runFetch);
  broadcastPapersChanged({ action: "queue_enqueued", count: jobs.length });
  return { queued: jobs.length };
}

async function drainFetchQueue(runFetch: FetchRunner): Promise<void> {
  const limit = fetchConcurrencyLimit();
  while (fetchActive < limit && fetchQueue.length > 0) {
    const job = fetchQueue.shift();
    if (!job) break;
    fetchActive++;
    void (async () => {
      try {
        const channel = job.ctx?.channel;
        const send = (payload: unknown) => {
          if (!job.sender || job.sender.isDestroyed()) return;
          try { job.sender.send("fetch:queue", { paperId: job.paperId, channel, ...(payload as object) }); } catch { /* ignore */ }
        };
        send({ status: "running" });
        const res = await runFetch(job.paperId, (ev) => send({ trace: ev }), job.ctx);
        send({ status: "done", result: res });
      } catch (e) {
        if (job.sender && !job.sender.isDestroyed()) {
          try {
            job.sender.send("fetch:queue", {
              paperId: job.paperId,
              channel: job.ctx?.channel,
              status: "failed",
              result: { ok: false, reason: String((e as Error)?.message || e) },
            });
          } catch { /* ignore */ }
        }
      } finally {
        fetchActive--;
        void drainFetchQueue(runFetch);
        if (fetchQueue.length === 0 && fetchActive === 0) {
          broadcastPapersChanged({ action: "queue_idle" });
        }
      }
    })();
  }
}

export function fetchQueueStatus(): { pending: number; active: number } {
  return { pending: fetchQueue.length, active: fetchActive };
}
