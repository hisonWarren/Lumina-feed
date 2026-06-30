// 阅读缓存 docKey 迁移（导入工作集 / 路径变更时合并 reader_analysis 与侧车数据）
import type { Database } from "better-sqlite3";

type SqliteLike = Database;

const SIDECAR_PREFIXES = ["anno:", "translate:", "navmark:"] as const;

function mergeJsonPayload(existing: unknown, incoming: unknown, prefix: string): unknown {
  if (prefix === "anno:") {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(incoming) ? incoming : [];
    if (!b.length) return a;
    if (!a.length) return b;
    const seen = new Set(a.map((x: { id?: string }) => x?.id).filter(Boolean));
    const merged = a.slice();
    for (const item of b) {
      const id = item && (item as { id?: string }).id;
      if (id && seen.has(id)) continue;
      merged.push(item);
    }
    return merged;
  }
  if (prefix === "translate:" || prefix === "navmark:") {
    if (prefix === "navmark:") {
      const a = Array.isArray(existing) ? existing : [];
      const b = Array.isArray(incoming) ? incoming : [];
      return Array.from(new Set([...a, ...b])).sort((x, y) => x - y).slice(0, 200);
    }
    const a = existing && typeof existing === "object" ? { ...(existing as object) } : {};
    const b = incoming && typeof incoming === "object" ? (incoming as Record<string, unknown>) : {};
    return { ...a, ...b };
  }
  return incoming ?? existing;
}

export function migrateSourcesCacheSidecar(
  db: SqliteLike,
  fromDocKey: string,
  toDocKey: string,
): void {
  if (!fromDocKey || !toDocKey || fromDocKey === toDocKey) return;
  db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
  const now = new Date().toISOString();
  for (const p of SIDECAR_PREFIXES) {
    const fromK = p + fromDocKey;
    const toK = p + toDocKey;
    const row = db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(fromK) as { payload?: string } | undefined;
    if (!row?.payload) continue;
    let incoming: unknown;
    try { incoming = JSON.parse(row.payload); } catch { continue; }
    const dest = db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(toK) as { payload?: string } | undefined;
    let existing: unknown;
    try { existing = dest?.payload ? JSON.parse(dest.payload) : undefined; } catch { existing = undefined; }
    const merged = mergeJsonPayload(existing, incoming, p);
    db.prepare(
      "INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
    ).run(toK, JSON.stringify(merged), now);
  }
}

export function migrateReaderAnalysisKeys(
  db: SqliteLike,
  fromKeys: string[],
  toKey: string,
): void {
  if (!toKey) return;
  db.exec("CREATE TABLE IF NOT EXISTS reader_analysis(paper_id TEXT, kind TEXT, lane TEXT, payload TEXT, model TEXT, created_at TEXT, PRIMARY KEY(paper_id,kind));");
  const uniqFrom = [...new Set(fromKeys.filter((k) => k && k !== toKey))];
  for (const from of uniqFrom) {
    const rows = db.prepare("SELECT kind, lane, payload, model, created_at FROM reader_analysis WHERE paper_id=?").all(from) as Array<{
      kind: string; lane: string; payload: string; model: string; created_at: string;
    }>;
    for (const r of rows) {
      const exists = db.prepare("SELECT 1 FROM reader_analysis WHERE paper_id=? AND kind=?").get(toKey, r.kind);
      if (exists) continue;
      db.prepare(
        "INSERT INTO reader_analysis(paper_id,kind,lane,payload,model,created_at) VALUES(?,?,?,?,?,?)",
      ).run(toKey, r.kind, r.lane, r.payload, r.model, r.created_at);
    }
  }
}

export function migrateDocKeys(
  db: SqliteLike,
  fromKeys: string[],
  toKey: string,
): void {
  migrateReaderAnalysisKeys(db, fromKeys, toKey);
  for (const from of fromKeys) {
    if (from && from !== toKey) migrateSourcesCacheSidecar(db, from, toKey);
  }
}
