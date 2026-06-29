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
  type FetchContext,
  type PaperAssetSnapshot,
} from "../src/core/store/paper-asset.ts";

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
  const stub: Paper = {
    id: paperId,
    title: title || paperId,
    authors: [],
    studyTypes: [],
    versions: [],
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
      if (settings.autoIngestOnFetch !== false && !libraryHas(deps.store.db, paperId)) {
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
        const send = (payload: unknown) => {
          if (!job.sender || job.sender.isDestroyed()) return;
          try { job.sender.send("fetch:queue", { paperId: job.paperId, ...(payload as object) }); } catch { /* ignore */ }
        };
        send({ status: "running" });
        const res = await runFetch(job.paperId, (ev) => send({ trace: ev }), job.ctx);
        send({ status: "done", result: res });
      } catch (e) {
        if (job.sender && !job.sender.isDestroyed()) {
          try {
            job.sender.send("fetch:queue", {
              paperId: job.paperId,
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
