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

  return { papers: postProcess(all, spec), perSource, raw: all };
}

// 归一化 → 去重/版本归并 → 结构化过滤 → 排序（一次性与流式共用，保证两条路径结果一致）。
function postProcess(all: SearchHit[], spec: QuerySpec): Paper[] {
  let papers = all.map(normalize);
  papers = dedupeAndMerge(papers);
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
  papers.sort((a, b) => (b.pubDate ?? "").localeCompare(a.pubDate ?? ""));
  return papers;
}

// 渐进式聚合：每个源返回即回调当前累积快照（去重/过滤/排序后），慢源不拖累首屏。
// 保留 aggregateSearch（一次性）供订阅等调用；本函数仅检索 UI 用。
export type StreamCb = (sourceId: string, snapshot: Paper[], perSource: AggregateResult["perSource"]) => void;
export async function aggregateSearchStream(spec: QuerySpec, opts: SearchOpts = {}, onSource?: StreamCb): Promise<AggregateResult> {
  const adapters = selectAdapters(spec.filters.sources);
  const perSource: AggregateResult["perSource"] = {};
  const all: SearchHit[] = [];
  await Promise.all(adapters.map(async (a) => {
    try {
      const hits = await a.search(spec, opts);
      perSource[a.id] = { count: hits.length, ok: true };
      all.push(...hits);
    } catch (e) {
      perSource[a.id] = { count: 0, ok: false, error: String((e as Error)?.message ?? e) };
    }
    try { onSource && onSource(a.id, postProcess(all, spec), { ...perSource }); } catch { /* 回调异常不影响聚合 */ }
  }));
  return { papers: postProcess(all, spec), perSource, raw: all };
}
