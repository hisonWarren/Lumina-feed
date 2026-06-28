// lumina-feed · 多源聚合
// 并发跑各源适配器（部分成功：单源失败不拖垮整份）→ 归一化 → 清洗 → 去重 → BM25 重排。
import type { SearchHit, Paper } from "./model.ts";
import type { QuerySpec } from "./querySpec.ts";
import { specToRaw } from "./querySpec.ts";
import { selectAdapters } from "./sources/index.ts";
import type { SearchOpts } from "./sources/adapter.ts";
import { normalize } from "./normalize.ts";
import { dedupeAndMerge } from "./dedupe.ts";
import { normalizePaper } from "./paper-hygiene.ts";
import { rerank } from "./rank/rerank.ts";
import type { MatchKind } from "./rank/bm25.ts";
import { withTimeout, TimeoutError } from "./sources/with-timeout.ts";
import { timeoutFor } from "./sources/adapter-meta.ts";
import { installDefaultLimiters } from "./sources/rate-limit.ts";
import { enrichSparsePapers } from "./locate/enrich-metadata.ts";

installDefaultLimiters();

export interface AggregateResult {
  papers: Paper[];
  perSource: Record<string, { count: number; ok: boolean; error?: string }>;
  raw: SearchHit[];
  mergedCount?: number;
}

export type RankedPaper = Paper & { _matchKind?: MatchKind };

function postProcess(all: SearchHit[], spec: QuerySpec): RankedPaper[] {
  let papers: RankedPaper[] = all.map((h) => normalizePaper(normalize(h)) as RankedPaper);
  const before = papers.length;
  papers = dedupeAndMerge(papers) as RankedPaper[];
  const mergedCount = before - papers.length >= 0 ? papers.length : papers.length;

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

  const rawQ = spec.raw || specToRaw(spec);
  const ranked = rerank(papers, rawQ, { sort: f.sort ?? "relevance", field: f.field ?? "all" });
  return ranked.map((r) => ({ ...r.item, _matchKind: r.matchKind }));
}

async function postProcessAsync(all: SearchHit[], spec: QuerySpec, opts: SearchOpts = {}): Promise<RankedPaper[]> {
  let papers = postProcess(all, spec);
  papers = await enrichSparsePapers(papers, opts) as RankedPaper[];
  return papers;
}

/** Title Fast Lane：合并远端命中 + 本地库，按标题 query 重排 */
export function rankTitleLaneHits(
  hits: SearchHit[],
  localPapers: Paper[],
  titleQ: string,
  spec: QuerySpec,
): RankedPaper[] {
  const laneSpec: QuerySpec = { ...spec, raw: titleQ, filters: { ...spec.filters, field: "title" } };
  let papers = postProcess(hits, laneSpec);
  if (localPapers.length) {
    const byId = new Map(papers.map((p) => [p.id, p]));
    for (const lp of localPapers) {
      if (!byId.has(lp.id)) papers.push(lp as RankedPaper);
    }
    const ranked = rerank(papers, titleQ, { sort: "relevance", field: "title" });
    papers = ranked.map((r) => ({ ...r.item, _matchKind: r.matchKind }));
  }
  return papers;
}

async function searchOne(
  a: { id: string; search: (q: QuerySpec, o?: SearchOpts) => Promise<SearchHit[]> },
  spec: QuerySpec,
  opts: SearchOpts,
): Promise<{ id: string; hits: SearchHit[]; error?: string }> {
  try {
    const hits = await withTimeout(a.search(spec, opts), timeoutFor(a.id));
    return { id: a.id, hits };
  } catch (e) {
    const msg = e instanceof TimeoutError ? "timeout" : String((e as Error)?.message ?? e);
    return { id: a.id, hits: [], error: msg };
  }
}

export async function aggregateSearch(spec: QuerySpec, opts: SearchOpts = {}): Promise<AggregateResult> {
  const adapters = selectAdapters(spec.filters.sources, opts.keys, opts.disabledSources);
  const perSource: AggregateResult["perSource"] = {};
  const settled = await Promise.all(adapters.map((a) => searchOne(a, spec, opts)));

  const all: SearchHit[] = [];
  for (const s of settled) {
    if (s.error) perSource[s.id] = { count: 0, ok: false, error: s.error };
    else { perSource[s.id] = { count: s.hits.length, ok: true }; all.push(...s.hits); }
  }

  const papers = await postProcessAsync(all, spec, opts);
  return { papers, perSource, raw: all, mergedCount: papers.length };
}

export type StreamCb = (sourceId: string, snapshot: Paper[], perSource: AggregateResult["perSource"]) => void;

export async function aggregateSearchStream(spec: QuerySpec, opts: SearchOpts = {}, onSource?: StreamCb): Promise<AggregateResult> {
  const adapters = selectAdapters(spec.filters.sources, opts.keys, opts.disabledSources);
  const perSource: AggregateResult["perSource"] = {};
  const all: SearchHit[] = [];
  await Promise.all(adapters.map(async (a) => {
    const s = await searchOne(a, spec, opts);
    if (s.error) perSource[s.id] = { count: 0, ok: false, error: s.error };
    else { perSource[s.id] = { count: s.hits.length, ok: true }; all.push(...s.hits); }
    try {
      const snapshot = await postProcessAsync(all, spec, opts);
      onSource && onSource(a.id, snapshot, { ...perSource });
    } catch { /* 回调异常不影响聚合 */ }
  }));
  const papers = await postProcessAsync(all, spec, opts);
  return { papers, perSource, raw: all, mergedCount: papers.length };
}

/** 单源重试（P9 HitSources 重试按钮） */
export async function searchSingleSource(
  sourceId: string,
  spec: QuerySpec,
  opts: SearchOpts = {},
): Promise<{ id: string; hits: SearchHit[]; error?: string; papers: RankedPaper[] }> {
  const adapter = selectAdapters([sourceId], opts.keys, opts.disabledSources).find((a) => a.id === sourceId);
  if (!adapter) {
    const disabled = (opts.disabledSources ?? []).map((s) => s.toLowerCase()).includes(sourceId.toLowerCase());
    return { id: sourceId, hits: [], error: disabled ? "source_disabled" : "unknown_source", papers: [] };
  }
  const s = await searchOne(adapter, spec, opts);
  const papers = s.hits.length ? await postProcessAsync(s.hits, spec, opts) : [];
  return { ...s, papers };
}
