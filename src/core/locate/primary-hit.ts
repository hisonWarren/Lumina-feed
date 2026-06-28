// 从候选池中判定「已锁定目标篇」（title_exact + 分数间隔）
import { bm25Rank, parseQuery, type MatchKind, type ParsedQuery } from "../rank/bm25.ts";

export type PrimaryHit = {
  paperId: string;
  matchKind: MatchKind;
  ambiguous: boolean;
  scoreGap: number;
};

type Candidate = { id?: string; title?: string; _matchKind?: MatchKind };

export function pickPrimaryHit(
  papers: Candidate[],
  rawQuery: string,
  field: ParsedQuery["field"] = "all",
): PrimaryHit | null {
  if (!papers.length) return null;
  const pq = parseQuery(titleQueryForRank(rawQuery), field === "title" ? "title" : field);
  const ranked = bm25Rank(papers, pq);
  const top = ranked[0];
  if (!top || top.matchKind !== "title_exact") return null;
  const second = ranked[1];
  const gap = second ? top.score - second.score : 99;
  const ambiguous = !!(second && second.matchKind === "title_exact" && gap < 3.5);
  const id = (top.item as Candidate).id;
  if (!id) return null;
  return { paperId: id, matchKind: top.matchKind, ambiguous, scoreGap: gap };
}

function titleQueryForRank(raw: string): string {
  return String(raw || "").trim().replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
}
