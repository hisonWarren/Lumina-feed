// 订阅简报检索：与 FindFetch 对齐 keys/depth/disabledSources，但用 Digest Profile 排除 scrape 源。
import type { QuerySpec } from "../querySpec.ts";
import { rawToSpec } from "../querySpec.ts";
import type { Paper } from "../model.ts";
import type { SearchOpts } from "../sources/adapter.ts";

/** 定时简报永不纳入的源（非开放 API / 慢 scrape） */
export const DIGEST_EXCLUDE_SOURCES = ["libgen", "annas", "scihub"] as const;

/** 期刊订阅白名单（扩展至 8 源，仍不含 scrape） */
export const JOURNAL_DIGEST_SOURCES = [
  "pubmed", "europepmc", "crossref", "openalex",
  "semanticscholar", "doaj", "arxiv", "biorxiv",
] as const;

export function mergeDigestDisabled(userDisabled: string[] = []): string[] {
  const set = new Set([...userDisabled, ...DIGEST_EXCLUDE_SOURCES].map((s) => s.toLowerCase()));
  return [...set];
}

export function applyDigestSearchOpts(base: SearchOpts, preview = false): SearchOpts {
  return {
    ...base,
    limit: preview ? 5 : base.limit,
    disabledSources: mergeDigestDisabled(base.disabledSources ?? []),
  };
}

export function buildDigestSpec(sub: Record<string, unknown> | null | undefined): QuerySpec | null {
  if (!sub) return null;
  const kind = (sub.kind as string) || "keyword";
  if (kind === "journal") {
    const j = (sub.journal as { issn?: string; name?: string }) || {};
    const value = (j.issn && String(j.issn).trim()) || (j.name && String(j.name).trim()) || String(sub.q || "").trim();
    if (!value) return null;
    return {
      groups: [{ op: "AND", terms: [{ field: "journal", value }] }],
      filters: { sources: [...JOURNAL_DIGEST_SOURCES] },
    };
  }
  const spec = rawToSpec(String(sub.q || ""), {});
  if (!spec.groups.length) return null;
  return spec;
}

/** ISSUE-011 · 脏 payload 容错 + schemaVersion */
export function digestDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 简报检索时间窗起点（本地时区）：daily=今日 0 点 · weekly=近 7 日 · hourly=上次运行 */
export function digestWindowStartMs(freq: string, now = new Date(), lastRunAt?: string): number {
  if (freq === "hourly") {
    const last = lastRunAt ? new Date(lastRunAt).getTime() : NaN;
    if (Number.isFinite(last)) return last;
    return now.getTime() - 55 * 60 * 1000;
  }
  if (freq === "weekly") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 按发表日期收窄候选；无 pubDate 的条目保留（部分源不返回日期） */
export function filterDigestRecency(papers: Paper[], freq: string, now = new Date(), lastRunAt?: string): Paper[] {
  const since = digestWindowStartMs(freq, now, lastRunAt);
  return papers.filter((p) => {
    if (!p.pubDate) return true;
    const t = new Date(p.pubDate).getTime();
    return Number.isFinite(t) && t >= since;
  });
}

export function normalizeSubscription(sub: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!sub || typeof sub !== "object") return { schemaVersion: 2, kind: "keyword", q: "", seenIds: [], today: [], todayDateKey: "" };
  return {
    schemaVersion: 2,
    sortMode: "relevance",
    autoSummarize: "blurb",
    enabled: true,
    freq: "daily",
    time: "08:00",
    ...sub,
    seenIds: Array.isArray(sub.seenIds) ? sub.seenIds : [],
    readIds: Array.isArray(sub.readIds) ? sub.readIds : [],
    today: Array.isArray(sub.today) ? sub.today : [],
    todayDateKey: typeof sub.todayDateKey === "string" ? sub.todayDateKey : "",
  };
}

/** 用户「标记已读」持久化 id 集合（与引擎 seenIds 去重分离） */
export function subscriptionReadIds(sub: Record<string, unknown> | null | undefined): Set<string> {
  if (!sub) return new Set();
  return new Set((Array.isArray(sub.readIds) ? sub.readIds : []).map(String));
}

export function todayPaperList(sub: Record<string, unknown> | null | undefined): Paper[] {
  if (!sub || !Array.isArray(sub.today)) return [];
  return (sub.today as Paper[]).filter((p) => p && typeof p === "object" && p.id);
}

/** 单订阅待读数（today 中未在 readIds 的条数） */
export function unreadTodayCount(sub: Record<string, unknown> | null | undefined): number {
  if (!sub || sub.enabled === false) return 0;
  const read = subscriptionReadIds(sub);
  return todayPaperList(sub).filter((p) => !read.has(p.id)).length;
}

/** 顶栏/托盘待读徽标：各启用订阅待读之和 */
export function countSubsUnread(subs: Record<string, unknown>[]): number {
  return (Array.isArray(subs) ? subs : []).reduce((n, sub) => n + unreadTodayCount(sub), 0);
}

export function isPaperUnread(sub: Record<string, unknown>, paperId: string): boolean {
  return todayPaperList(sub).some((p) => p.id === paperId) && !subscriptionReadIds(sub).has(paperId);
}

export function withPaperMarkedRead(sub: Record<string, unknown>, paperId: string): Record<string, unknown> {
  const todayIds = new Set(todayPaperList(sub).map((p) => p.id));
  if (!todayIds.has(paperId)) return sub;
  const merged = new Set([...subscriptionReadIds(sub), paperId]);
  const readIds = [...merged].filter((id) => todayIds.has(id)).slice(-500);
  return { ...sub, readIds };
}

export type DigestNotifyTier = "calm" | "regular" | "power";

export interface DigestRunMeta {
  perSource: Record<string, { count: number; ok: boolean; error?: string }>;
  durationMs: number;
  mergedCount: number;
  preview?: boolean;
  ai?: import("./digest-ai.ts").DigestAiMeta;
}

export function freshHits(all: Paper[], seenIds: string[]): Paper[] {
  const seen = new Set(seenIds);
  return all.filter((p) => !seen.has(p.id));
}

/** 跨订阅 DOI 去重（「今日全部」视图） */
export function dedupeDigestPapers(
  entries: Array<{ subId: string; subLabel: string; paper: Paper }>,
): Array<{ paper: Paper; subIds: string[]; subLabels: string[] }> {
  const byKey = new Map<string, { paper: Paper; subIds: string[]; subLabels: string[] }>();
  for (const e of entries) {
    const key = (e.paper.doi && String(e.paper.doi).toLowerCase()) || e.paper.id;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { paper: e.paper, subIds: [e.subId], subLabels: [e.subLabel] });
    } else {
      if (!cur.subIds.includes(e.subId)) {
        cur.subIds.push(e.subId);
        cur.subLabels.push(e.subLabel);
      }
    }
  }
  return [...byKey.values()];
}
