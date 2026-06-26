// lumina-feed · 存储底座（SQLite + FTS5）
// 抽象出最小 SqliteDb 接口：better-sqlite3（生产）与 node:sqlite（测试/沙箱）皆满足。
// FTS5 用「外部内容表 + 同步触发器 + 稳定 rowid 的 upsert(ON CONFLICT DO UPDATE)」保证检索与库同步。

export interface SqliteStmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}
export interface SqliteDb {
  prepare(sql: string): SqliteStmt;
  exec(sql: string): void;
  close?(): void;
}

/** 沙箱/测试：Node 内置 SQLite（需 --experimental-sqlite） */
export async function openNodeSqlite(path = ":memory:"): Promise<SqliteDb> {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(path) as unknown as SqliteDb;
}
/** 生产：better-sqlite3（npm i better-sqlite3） */
export async function openBetterSqlite(path: string): Promise<SqliteDb> {
  const Database = (await import("better-sqlite3")).default as any;
  return new Database(path) as SqliteDb;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS papers(
  id TEXT PRIMARY KEY, doi TEXT, pmid TEXT, pmcid TEXT, arxiv_id TEXT,
  title TEXT NOT NULL, abstract TEXT, authors_json TEXT,
  journal TEXT, journal_abbrev TEXT, issn TEXT,
  pub_date TEXT, year INTEGER, volume TEXT, issue TEXT, pages TEXT,
  study_types_json TEXT, primary_type TEXT, mesh_json TEXT, keywords_json TEXT,
  language TEXT, source TEXT,
  is_preprint INTEGER DEFAULT 0, peer_reviewed INTEGER DEFAULT 0, retracted INTEGER DEFAULT 0,
  citation_count INTEGER, oa_status TEXT, oa_url TEXT, is_oa INTEGER DEFAULT 0,
  pdf_ref TEXT, versions_json TEXT, ingested_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_source ON papers(source);
CREATE INDEX IF NOT EXISTS idx_papers_journal ON papers(journal);
CREATE INDEX IF NOT EXISTS idx_papers_pubdate ON papers(pub_date);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_ptype ON papers(primary_type);

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
  title, abstract, content='papers', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS papers_ai AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(rowid, title, abstract) VALUES (new.rowid, new.title, new.abstract);
END;
CREATE TRIGGER IF NOT EXISTS papers_ad AFTER DELETE ON papers BEGIN
  INSERT INTO papers_fts(papers_fts, rowid, title, abstract) VALUES ('delete', old.rowid, old.title, old.abstract);
END;
CREATE TRIGGER IF NOT EXISTS papers_au AFTER UPDATE ON papers BEGIN
  INSERT INTO papers_fts(papers_fts, rowid, title, abstract) VALUES ('delete', old.rowid, old.title, old.abstract);
  INSERT INTO papers_fts(rowid, title, abstract) VALUES (new.rowid, new.title, new.abstract);
END;

CREATE TABLE IF NOT EXISTS subscriptions(
  id TEXT PRIMARY KEY, name TEXT, query_spec_json TEXT, schedule_json TEXT,
  summarize_opts_json TEXT, last_run_at TEXT, seen_ids_json TEXT,
  enabled INTEGER DEFAULT 1, shared_with_json TEXT
);
CREATE TABLE IF NOT EXISTS digests(
  id TEXT PRIMARY KEY, date TEXT, subscription_id TEXT, paper_ids_json TEXT,
  stats_json TEXT, generated_at TEXT
);
CREATE TABLE IF NOT EXISTS summaries(
  id TEXT PRIMARY KEY, paper_id TEXT, subscription_id TEXT, depth TEXT, language TEXT,
  source_basis TEXT, text TEXT, model TEXT, structured_json TEXT, caveats_json TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS paper_state(
  paper_id TEXT PRIMARY KEY, read INTEGER DEFAULT 0,
  screening TEXT, starred INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS collection_items(collection_id TEXT, paper_id TEXT, PRIMARY KEY(collection_id, paper_id));
CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS paper_tags(paper_id TEXT, tag_id TEXT, PRIMARY KEY(paper_id, tag_id));
CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);
`;

export function bootstrap(db: SqliteDb): void {
  try { db.exec("PRAGMA journal_mode=WAL;"); } catch { /* :memory: 不支持 WAL,忽略 */ }
  db.exec(SCHEMA);
}
