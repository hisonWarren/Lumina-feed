// lumina-feed · 多源聚合
// 并发跑各源适配器（部分成功：单源失败不拖垮整份）→ 归一化 → 去重/版本归并。
import type { SearchHit, Paper } from "./model.ts";
import type { QuerySpec } from "./querySpec.ts";
import { selectAdapters } from "./sources/index.ts";
import type { SearchOpts } from "./sources/adapter.ts";
import { normalize } from "./normalize.ts";
import { dedupeAndMerge } from "./dedupe.ts";

export interface AggregateResult {
  papers: Paper[];
  perSource: Record<string, { count: number; ok: boolean; error?: string }>;
  raw: SearchHit[];
}

export async function aggregateSearch(spec: QuerySpec, opts: SearchOpts = {}): Promise<AggregateResult> {
  const adapters = selectAdapters(spec.filters.sources);
  const perSource: AggregateResult["perSource"] = {};
  const settled = await Promise.allSettled(
    adapters.map((a) => a.search(spec, opts).then((hits) => ({ id: a.id, hits })))
  );

  const all: SearchHit[] = [];
  settled.forEach((s, i) => {
    const id = adapters[i].id;
    if (s.status === "fulfilled") { perSource[id] = { count: s.value.hits.length, ok: true }; all.push(...s.value.hits); }
    else perSource[id] = { count: 0, ok: false, error: String((s.reason as Error)?.message ?? s.reason) }; // 标记失败,不抛
  });

  let papers = all.map(normalize);
  papers = dedupeAndMerge(papers);

  // 结构化后过滤（peerReviewed/OA/type/language/year）—— 源端能力不一,这里统一兜底
  const f = spec.filters;
  papers = papers.filter((p) => {
    if (f.peerReviewedOnly && !p.peerReviewed) return false;
    if (f.openAccessOnly && !(p.oaUrl || p.oaStatus)) return false;
    if (f.languages?.length && p.language && !f.languages.includes(p.language)) return false;
    if (f.yearFrom && p.year && p.year < f.yearFrom) return false;
    if (f.yearTo && p.year && p.year > f.yearTo) return false;
    if (f.types?.length && !p.studyTypes.some((t) => f.types!.includes(t))) return false;
    return true;
  });

  // 默认按发表日期降序
  papers.sort((a, b) => (b.pubDate ?? "").localeCompare(a.pubDate ?? ""));
  return { papers, perSource, raw: all };
}
