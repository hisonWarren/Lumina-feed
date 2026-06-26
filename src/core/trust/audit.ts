// lumina-feed · 证据可信性 · 审计留痕（最小留痕，ADR-T3/T6）
// 只存 偏移 + 短引用 + 模型 + 时间 + 比例；不存/不分发全文。复用 M1 的 SqliteDb。
import type { GroundedSummary } from "./grounded-summary.ts";

interface SqliteLike { prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): any[] } }

export const GROUNDING_SCHEMA = `
CREATE TABLE IF NOT EXISTS groundings(
  id TEXT PRIMARY KEY, paper_id TEXT, summary_model TEXT, source_basis TEXT,
  grounded_ratio REAL, claims_json TEXT, banner TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_groundings_paper ON groundings(paper_id);
`;

export function ensureGroundingTable(db: SqliteLike): void {
  for (const stmt of GROUNDING_SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) db.prepare(stmt + ";").run();
}

/** 写一条 grounding 审计记录（claims 仅存偏移 + 短引用，不存源全文）。 */
export function saveGrounding(db: SqliteLike, paperId: string, model: string, sourceBasis: "fulltext" | "abstract", gs: GroundedSummary): void {
  ensureGroundingTable(db);
  const id = `${paperId}|${model}|${sourceBasis}`;
  const claims = gs.claims.map((c) => ({
    text: c.text, status: c.status, score: c.score,
    span: c.span ? { start: c.span.start, end: c.span.end, quote: c.span.quote.slice(0, 160) } : null, // 短引用上限
    numbersOk: c.numbersOk, missingNumbers: c.missingNumbers, entailment: c.entailment ?? null,
  }));
  db.prepare(
    `INSERT INTO groundings(id,paper_id,summary_model,source_basis,grounded_ratio,claims_json,banner,created_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET grounded_ratio=excluded.grounded_ratio, claims_json=excluded.claims_json, banner=excluded.banner, created_at=excluded.created_at`
  ).run(id, paperId, model, sourceBasis, gs.groundedRatio, JSON.stringify(claims), gs.banner ?? null, new Date().toISOString());
}

export function loadGroundings(db: SqliteLike, paperId: string): any[] {
  ensureGroundingTable(db);
  return db.prepare("SELECT * FROM groundings WHERE paper_id=? ORDER BY created_at DESC").all(paperId);
}
