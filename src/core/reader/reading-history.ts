// 继续阅读 · 持久化 LRU（元数据 only；打开时再读盘）
import fs from "node:fs";
import path from "node:path";
import type { SqliteDb } from "../store/db.ts";
import { importMapPathKey } from "../store/local-import.ts";

export type ReadingHistoryKind = "paper" | "local";

export type ReadingHistoryRow = {
  entry_key: string;
  kind: ReadingHistoryKind;
  paper_id: string | null;
  local_path: string | null;
  title: string;
  page: number;
  opened_at: string;
  updated_at: string;
};

export type ContinueReadingEntry = {
  entryKey: string;
  kind: ReadingHistoryKind;
  paperId?: string;
  localPath?: string;
  title: string;
  page: number;
  openedAt: string;
  /** 文件/PDF 已不可用 */
  missing?: boolean;
  /** paper 类：本机是否仍有 PDF */
  hasPdf?: boolean;
  /** paper 类：工作集来源（local_import / find_fetch 等） */
  provenance?: string;
};

export const CONTINUE_READING_LIMIT = 15;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reading_history(
  entry_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  paper_id TEXT,
  local_path TEXT,
  title TEXT NOT NULL,
  page INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reading_history_opened ON reading_history(opened_at DESC);
`;

export function ensureReadingHistoryTable(db: SqliteDb): void {
  db.exec(SCHEMA);
}

export function normalizeLocalPath(p: string): string {
  return path.normalize(path.resolve(String(p || "").trim()));
}

/** 阅读缓存 docKey 用的本地路径段：统一正斜杠 + Windows 盘符小写，避免 D:/ 与 d:/ 各存一份。 */
export function localPathDocKeySegment(p: string): string {
  let s = path.resolve(String(p || "").trim()).replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s;
}

export function localDocKey(p: string): string {
  return `local:${localPathDocKeySegment(p)}`;
}

export function entryKeyFor(opts: { paperId?: string; localPath?: string }): string | null {
  if (opts.paperId) return `paper:${opts.paperId}`;
  if (opts.localPath) return localDocKey(opts.localPath);
  return null;
}

export function isSafeLocalPdfPath(p: string): boolean {
  const resolved = normalizeLocalPath(p);
  if (!path.isAbsolute(resolved)) return false;
  if (!/\.pdf$/i.test(resolved)) return false;
  try {
    const st = fs.statSync(resolved);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

export function recordReadingOpen(
  db: SqliteDb,
  opts: { paperId?: string; localPath?: string; title: string; page?: number },
): ContinueReadingEntry | null {
  ensureReadingHistoryTable(db);
  const title = String(opts.title || "").trim() || "未命名 PDF";
  let page = Math.max(1, Math.floor(opts.page ?? 1));
  const now = new Date().toISOString();
  let kind: ReadingHistoryKind;
  let entryKey: string | null;
  let paperId: string | null = null;
  let localPath: string | null = null;

  if (opts.paperId) {
    kind = "paper";
    paperId = String(opts.paperId);
    entryKey = entryKeyFor({ paperId });
    if (opts.localPath) {
      const lk = entryKeyFor({ localPath: opts.localPath });
      if (lk) {
        const prev = db.prepare("SELECT page FROM reading_history WHERE entry_key=?").get(lk) as { page?: number } | undefined;
        if (prev?.page && prev.page > page) page = prev.page;
        db.prepare("DELETE FROM reading_history WHERE entry_key=?").run(lk);
      }
    }
  } else if (opts.localPath) {
    kind = "local";
    localPath = normalizeLocalPath(opts.localPath);
    entryKey = entryKeyFor({ localPath });
  } else {
    return null;
  }
  if (!entryKey) return null;

  db.prepare(
    `INSERT INTO reading_history(entry_key, kind, paper_id, local_path, title, page, opened_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(entry_key) DO UPDATE SET
       title=excluded.title,
       page=excluded.page,
       opened_at=excluded.opened_at,
       updated_at=excluded.updated_at`,
  ).run(entryKey, kind, paperId, localPath, title, page, now, now);

  // LRU trim
  const rows = db.prepare(
    "SELECT entry_key FROM reading_history ORDER BY opened_at DESC LIMIT -1 OFFSET ?",
  ).all(CONTINUE_READING_LIMIT) as { entry_key: string }[];
  for (const r of rows) {
    db.prepare("DELETE FROM reading_history WHERE entry_key=?").run(r.entry_key);
  }

  return {
    entryKey,
    kind,
    paperId: paperId ?? undefined,
    localPath: localPath ?? undefined,
    title,
    page,
    openedAt: now,
  };
}

export function touchReadingPage(db: SqliteDb, entryKey: string, page: number): void {
  ensureReadingHistoryTable(db);
  const p = Math.max(1, Math.floor(page));
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE reading_history SET page=?, updated_at=? WHERE entry_key=?",
  ).run(p, now, entryKey);
}

export function listContinueReading(
  db: SqliteDb,
  enrich?: (row: ReadingHistoryRow) => { title?: string; missing?: boolean; hasPdf?: boolean; provenance?: string },
  limit = CONTINUE_READING_LIMIT,
): ContinueReadingEntry[] {
  ensureReadingHistoryTable(db);
  purgeStaleLocalContinueEntries(db);
  const rows = db.prepare(
    "SELECT * FROM reading_history ORDER BY opened_at DESC LIMIT ?",
  ).all(limit) as ReadingHistoryRow[];
  return rows.map((r) => {
    const extra = enrich ? enrich(r) : {};
    return {
      entryKey: r.entry_key,
      kind: r.kind as ReadingHistoryKind,
      paperId: r.paper_id ?? undefined,
      localPath: r.local_path ?? undefined,
      title: extra.title ?? r.title,
      page: r.page,
      openedAt: r.opened_at,
      missing: extra.missing,
      hasPdf: extra.hasPdf,
      provenance: extra.provenance,
    };
  });
}

/** 本地 PDF 已导入工作集后，移除残留的 local: 继续阅读行（与 paper: 重复） */
export function purgeStaleLocalContinueEntries(db: SqliteDb): void {
  ensureReadingHistoryTable(db);
  const locals = db.prepare(
    "SELECT entry_key, local_path FROM reading_history WHERE kind='local' AND local_path IS NOT NULL",
  ).all() as { entry_key: string; local_path: string }[];
  for (const r of locals) {
    if (!r.local_path) continue;
    try {
      const row = db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(importMapPathKey(r.local_path)) as { payload?: string } | undefined;
      if (!row?.payload) continue;
      const { paperId } = JSON.parse(row.payload) as { paperId?: string };
      if (!paperId) continue;
      const hasPaper = db.prepare("SELECT 1 FROM reading_history WHERE entry_key=?").get(`paper:${paperId}`);
      if (hasPaper) removeReadingHistory(db, r.entry_key);
    } catch { /* ignore */ }
  }
}

export function removeReadingHistory(db: SqliteDb, entryKey: string): boolean {
  ensureReadingHistoryTable(db);
  try {
    db.prepare("DELETE FROM reading_history WHERE entry_key=?").run(entryKey);
    return true;
  } catch {
    return false;
  }
}

export function clearReadingHistory(db: SqliteDb): void {
  ensureReadingHistoryTable(db);
  db.exec("DELETE FROM reading_history");
}

export function openedAtForPaper(db: SqliteDb, paperId: string): string | undefined {
  ensureReadingHistoryTable(db);
  const r = db.prepare("SELECT opened_at FROM reading_history WHERE entry_key=?").get(`paper:${paperId}`) as
    | { opened_at?: string }
    | undefined;
  return r?.opened_at;
}
