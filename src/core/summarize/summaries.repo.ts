// lumina-feed · 总结缓存（ADR-3 控成本）
import type { SummaryCache, SummaryResult, SummarizeOptions } from "./types.ts";

/** 内存缓存（测试 / 短会话） */
export function memoryCache(): SummaryCache {
  const m = new Map<string, SummaryResult>();
  return { get: (k) => m.get(k) ?? null, put: (k, v) => { m.set(k, v); } };
}

interface SqliteLike { prepare(sql: string): { run(...p: unknown[]): unknown; get(...p: unknown[]): any } }

/** SQLite 缓存（summaries 表；与 M1 同一 SqliteDb）。
 *  key = paperId|depth|language；命中即跳过 LLM。 */
export function sqliteSummaryCache(db: SqliteLike): SummaryCache {
  return {
    get(key) {
      const [paperId, depth, language] = key.split("|");
      const r = db.prepare("SELECT * FROM summaries WHERE paper_id=? AND depth=? AND language=? ORDER BY created_at DESC LIMIT 1").get(paperId, depth, language);
      if (!r) return null;
      return {
        text: r.text, sourceBasis: r.source_basis, model: r.model,
        depth: r.depth as SummarizeOptions["depth"], language: r.language as SummarizeOptions["language"],
        structured: r.structured_json ? safe(r.structured_json) : undefined,
        caveats: r.caveats_json ? safe(r.caveats_json) ?? [] : [],
      };
    },
    put(key, v) {
      const [paperId, depth, language] = key.split("|");
      const id = `${paperId}|${depth}|${language}|${v.sourceBasis}`;
      db.prepare(
        `INSERT INTO summaries(id,paper_id,subscription_id,depth,language,source_basis,text,model,structured_json,caveats_json,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET text=excluded.text, source_basis=excluded.source_basis, model=excluded.model,
           structured_json=excluded.structured_json, caveats_json=excluded.caveats_json, created_at=excluded.created_at`
      ).run(id, paperId, null, depth, language, v.sourceBasis, v.text, v.model,
        v.structured ? JSON.stringify(v.structured) : null, JSON.stringify(v.caveats ?? []), new Date().toISOString());
    },
  };
}

function safe(s: string) { try { return JSON.parse(s); } catch { return undefined; } }
