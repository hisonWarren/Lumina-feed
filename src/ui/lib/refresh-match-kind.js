// 会话恢复 / 流式合并后，用当前 bm25 规则重算 matchKind（避免旧快照误标 title_exact）
import { rerank } from "../../core/rank/rerank.ts";

export function refreshCardMatchKinds(cards, rawQuery, field = "all") {
  if (!rawQuery || !Array.isArray(cards) || !cards.length) return cards || [];
  const papers = cards.map((c) => ({
    id: c.id,
    title: c.title,
    abstract: c.abstract || "",
    authors: c.authors || [],
    year: c.year,
    journal: c.journal,
    keywords: [],
  }));
  const ranked = rerank(papers, rawQuery, { sort: "relevance", field });
  const kindById = new Map(ranked.map((r) => [r.item.id, r.matchKind]));
  return cards.map((c) => ({ ...c, matchKind: kindById.get(c.id) ?? null }));
}
