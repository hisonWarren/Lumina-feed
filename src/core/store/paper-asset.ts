// lumina-feed · 文献资产层（PDF 落盘 · fetch_log · 工作集 ingest 共享逻辑）
import type { Database } from "better-sqlite3";

export interface FetchContext {
  provenance?: string;
  channel?: string;
}

export interface FetchLogRow {
  paper_id: string;
  source: string;
  fetched_at: string;
  channel: string;
  provenance: string;
}

export interface PaperAssetSnapshot {
  paperId: string;
  hasPdf: boolean;
  inLibrary: boolean;
  provenance: string | null;
  fetchSource: string | null;
  fetchedAt: string | null;
  channel: string | null;
}

export function ensurePaperAssetTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fetch_log(
      paper_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'manual',
      provenance TEXT NOT NULL DEFAULT 'find_fetch'
    );
    CREATE TABLE IF NOT EXISTS library_detach_log(
      paper_id TEXT PRIMARY KEY,
      detached_at TEXT NOT NULL
    );
  `);
}

export function recordFetchLog(
  db: Database,
  paperId: string,
  source: string,
  ctx: FetchContext = {},
): void {
  ensurePaperAssetTables(db);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO fetch_log(paper_id, source, fetched_at, channel, provenance)
    VALUES(?,?,?,?,?)
    ON CONFLICT(paper_id) DO UPDATE SET
      source=excluded.source,
      fetched_at=excluded.fetched_at,
      channel=excluded.channel,
      provenance=excluded.provenance
  `).run(
    paperId,
    source || "unknown",
    now,
    ctx.channel || "manual",
    ctx.provenance || "find_fetch",
  );
}

export function getFetchLog(db: Database, paperId: string): FetchLogRow | null {
  try {
    ensurePaperAssetTables(db);
    const r = db.prepare("SELECT paper_id, source, fetched_at, channel, provenance FROM fetch_log WHERE paper_id=?")
      .get(paperId) as FetchLogRow | undefined;
    return r ?? null;
  } catch {
    return null;
  }
}

export function listFetchLogs(db: Database): FetchLogRow[] {
  try {
    ensurePaperAssetTables(db);
    return db.prepare("SELECT paper_id, source, fetched_at, channel, provenance FROM fetch_log ORDER BY fetched_at DESC")
      .all() as FetchLogRow[];
  } catch {
    return [];
  }
}

export function deleteFetchLog(db: Database, paperId: string): void {
  try {
    ensurePaperAssetTables(db);
    db.prepare("DELETE FROM fetch_log WHERE paper_id=?").run(paperId);
  } catch { /* ignore */ }
}

export function libraryHas(db: Database, paperId: string): boolean {
  try {
    const r = db.prepare("SELECT 1 FROM library WHERE paper_id=?").get(paperId);
    return !!r;
  } catch {
    return false;
  }
}

export function libraryAdd(
  db: Database,
  paperId: string,
  provenance: string,
  touchAddedAt = true,
): void {
  db.exec("CREATE TABLE IF NOT EXISTS library(paper_id TEXT PRIMARY KEY, provenance TEXT, added_at TEXT);");
  clearLibraryDetach(db, paperId);
  if (touchAddedAt) {
    db.prepare(`
      INSERT INTO library(paper_id, provenance, added_at) VALUES(?,?,?)
      ON CONFLICT(paper_id) DO UPDATE SET provenance=excluded.provenance, added_at=excluded.added_at
    `).run(paperId, provenance, new Date().toISOString());
  } else {
    db.prepare(`
      INSERT INTO library(paper_id, provenance, added_at) VALUES(?,?,?)
      ON CONFLICT(paper_id) DO UPDATE SET provenance=excluded.provenance
    `).run(paperId, provenance, new Date().toISOString());
  }
}

/** 用户从工作集移除但保留 PDF 时记录，防止启动 reconcile 再次自动入库。 */
export function recordLibraryDetach(db: Database, paperId: string): void {
  ensurePaperAssetTables(db);
  db.prepare(`
    INSERT INTO library_detach_log(paper_id, detached_at) VALUES(?,?)
    ON CONFLICT(paper_id) DO UPDATE SET detached_at=excluded.detached_at
  `).run(paperId, new Date().toISOString());
}

export function clearLibraryDetach(db: Database, paperId: string): void {
  try {
    ensurePaperAssetTables(db);
    db.prepare("DELETE FROM library_detach_log WHERE paper_id=?").run(paperId);
  } catch { /* ignore */ }
}

export function isLibraryDetached(db: Database, paperId: string): boolean {
  try {
    ensurePaperAssetTables(db);
    return !!db.prepare("SELECT 1 FROM library_detach_log WHERE paper_id=?").get(paperId);
  } catch {
    return false;
  }
}

export function listLibraryDetached(db: Database): string[] {
  try {
    ensurePaperAssetTables(db);
    const rows = db.prepare("SELECT paper_id FROM library_detach_log ORDER BY detached_at DESC").all() as { paper_id: string }[];
    return rows.map((r) => r.paper_id);
  } catch {
    return [];
  }
}
