// Title Fast Lane：Crossref / OpenAlex / Europe PMC 标题字段并行检索（毫秒~秒级首包）
import type { QuerySpec } from "../querySpec.ts";
import type { SearchHit, Paper } from "../model.ts";
import type { SearchOpts } from "../sources/adapter.ts";
import { crossrefAdapter } from "../sources/crossref.ts";
import { openalexAdapter } from "../sources/openalex.ts";
import { europepmcAdapter } from "../sources/europepmc.ts";
import { withTimeout, TimeoutError } from "../sources/with-timeout.ts";
import { timeoutFor } from "../sources/adapter-meta.ts";
import { rankTitleLaneHits, type RankedPaper } from "../aggregate.ts";

const LANE_ADAPTERS = [crossrefAdapter, openalexAdapter, europepmcAdapter] as const;

async function laneOne(
  adapter: (typeof LANE_ADAPTERS)[number],
  spec: QuerySpec,
  opts: SearchOpts,
): Promise<{ id: string; hits: SearchHit[]; error?: string }> {
  try {
    const hits = await withTimeout(adapter.search(spec, { ...opts, limit: 12 }), Math.min(timeoutFor(adapter.id), 8000));
    return { id: adapter.id, hits };
  } catch (e) {
    const msg = e instanceof TimeoutError ? "timeout" : String((e as Error)?.message ?? e);
    return { id: adapter.id, hits: [], error: msg };
  }
}

/** 构造标题字段 QuerySpec（保留年份等过滤） */
export function titleFieldSpec(base: QuerySpec, titleQ: string): QuerySpec {
  return {
    groups: [{ op: "AND", terms: [{ field: "title", value: titleQ }] }],
    filters: { ...base.filters, field: "title" },
    raw: `"${titleQ}" [title]`,
  };
}

export async function titleFastLane(
  baseSpec: QuerySpec,
  titleQ: string,
  opts: SearchOpts = {},
  localPapers: Paper[] = [],
): Promise<{ papers: RankedPaper[]; perSource: Record<string, { count: number; ok: boolean; error?: string }> }> {
  const spec = titleFieldSpec(baseSpec, titleQ);
  const perSource: Record<string, { count: number; ok: boolean; error?: string }> = {};
  const settled = await Promise.all(LANE_ADAPTERS.map((a) => laneOne(a, spec, opts)));
  const all: SearchHit[] = [];
  for (const s of settled) {
    if (s.error) perSource[s.id] = { count: 0, ok: false, error: s.error };
    else {
      perSource[s.id] = { count: s.hits.length, ok: true };
      all.push(...s.hits);
    }
  }
  if (localPapers.length) {
    perSource.local = { count: localPapers.length, ok: true };
  }
  const papers = rankTitleLaneHits(all, localPapers, titleQ, spec);
  return { papers, perSource };
}
