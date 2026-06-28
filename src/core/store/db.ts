// lumina-feed · 存储（干净基线：papers + summaries + settings 缓存）
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
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
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
CREATE TABLE IF NOT EXISTS summaries(
  id TEXT PRIMARY KEY, paper_id TEXT, subscription_id TEXT, depth TEXT, language TEXT,
  source_basis TEXT, text TEXT, model TEXT, structured_json TEXT, caveats_json TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS paper_state(
  paper_id TEXT PRIMARY KEY, read INTEGER DEFAULT 0,
  screening TEXT, starred INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);
`;

export function bootstrap(db: SqliteDb): void {
  try { db.exec("PRAGMA journal_mode=WAL;"); } catch { /* ignore */ }
  db.exec(SCHEMA);
}
