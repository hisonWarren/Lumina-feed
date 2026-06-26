// lumina-feed · runSubscriptionDigest（M1 实装，替换 M5 的桩）
// 给定订阅与 sinceISO：多源聚合(自 since)→ 归一化/去重/版本归并 → 入库 → 返回新命中。
// Scheduler 再按 seenIds 去重并通知。总结(tldr/sourceBasis)由 M4 填，这里留空。
import type { Subscription, DigestItem } from "./schedule/types.ts";
import type { Paper } from "./model.ts";
import type { QuerySpec } from "./querySpec.ts";
import { aggregateSearch } from "./aggregate.ts";
import { getStore } from "./store/index.ts";
import type { SearchOpts } from "./sources/adapter.ts";

function startOfTodayISO(): string {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}

export function paperToDigestItem(p: Paper): DigestItem {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors,
    journal: p.journal,
    year: p.year,
    doi: p.doi,
    url: p.oaUrl ?? (p.doi ? `https://doi.org/${p.doi}` : undefined),
    isPreprint: p.isPreprint,
    type: p.studyTypes?.[0],
    tldr: undefined,        // ← M4 填
    sourceBasis: null,      // ← M4 填（fulltext/abstract）
  };
}

export interface DigestRunOptions extends SearchOpts {
  limitPerSource?: number;
  /** 注入 store（默认用全局 initStore 的单例） */
  store?: ReturnType<typeof getStore>;
}

export async function runSubscriptionDigest(
  sub: Subscription,
  sinceISO: string | null,
  opts: DigestRunOptions = {},
): Promise<{ items: DigestItem[]; perSource: Record<string, { count: number; ok: boolean; error?: string }> }> {
  const store = opts.store ?? getStore();
  // 首跑无 lastRun → 只取「今天」，避免把历史一次性回灌（Kai 边界）
  const since = sinceISO ?? startOfTodayISO();
  const spec = (sub.query ?? { groups: [], filters: {} }) as QuerySpec;

  const agg = await aggregateSearch(spec, { since, limit: opts.limitPerSource ?? 25, fetchImpl: opts.fetchImpl, signal: opts.signal });

  // 入库（去重已在聚合层做；upsert 幂等）
  store.papers.upsertMany(agg.papers);

  return { items: agg.papers.map(paperToDigestItem), perSource: agg.perSource };
}
