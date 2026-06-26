// lumina-feed · M6 趋势统计（探索台图表用）
import type { Paper } from "../model.ts";

export interface TrendPoint { key: string; count: number }

function tally(papers: Paper[], keyOf: (p: Paper) => string | number | undefined): TrendPoint[] {
  const m = new Map<string, number>();
  for (const p of papers) { const k = keyOf(p); if (k == null || k === "") continue; m.set(String(k), (m.get(String(k)) ?? 0) + 1); }
  return [...m.entries()].map(([key, count]) => ({ key, count }));
}

/** 按年份时间序列（升序），可补零年份。 */
export function trendByYear(papers: Paper[], fillGaps = true): TrendPoint[] {
  const pts = tally(papers, (p) => p.year).sort((a, b) => +a.key - +b.key);
  if (!fillGaps || pts.length < 2) return pts;
  const out: TrendPoint[] = [];
  const lo = +pts[0].key, hi = +pts[pts.length - 1].key;
  const byYear = new Map(pts.map((p) => [p.key, p.count]));
  for (let y = lo; y <= hi; y++) out.push({ key: String(y), count: byYear.get(String(y)) ?? 0 });
  return out;
}

export const countByType = (papers: Paper[]): TrendPoint[] => tally(papers, (p) => p.studyTypes?.[0]).sort((a, b) => b.count - a.count);
export const countBySource = (papers: Paper[]): TrendPoint[] => tally(papers, (p) => p.source).sort((a, b) => b.count - a.count);
export const topJournals = (papers: Paper[], n = 10): TrendPoint[] => tally(papers, (p) => p.journal).sort((a, b) => b.count - a.count).slice(0, n);

export interface Summary { total: number; preprints: number; openAccess: number; peerReviewed: number; retracted: number; withOaFulltext: number }
export function summarize(papers: Paper[]): Summary {
  return {
    total: papers.length,
    preprints: papers.filter((p) => p.isPreprint).length,
    openAccess: papers.filter((p) => p.oaUrl || p.oaStatus).length,
    peerReviewed: papers.filter((p) => p.peerReviewed).length,
    retracted: papers.filter((p) => p.retracted).length,
    withOaFulltext: papers.filter((p) => p.oaUrl).length,
  };
}
