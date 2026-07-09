// 订阅简报检索：与 FindFetch 对齐 keys/depth/disabledSources，但用 Digest Profile 排除 scrape 源。
import type { QuerySpec } from "../querySpec.ts";
import { rawToSpec, specToRaw } from "../querySpec.ts";
import type { Paper } from "../model.ts";
import type { SearchOpts } from "../sources/adapter.ts";
import { tokenize } from "../rank/bm25.ts";

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

/** 简报检索式附加过滤：按时间窗排序 + yearFrom（与 since 双闸） */
export function digestSpecFilters(freq: string, now = new Date(), lastRunAt?: string, sameDay = false) {
  const sinceMs = digestRecencyStartMs(freq, now, lastRunAt, sameDay);
  const sinceDate = new Date(sinceMs);
  return {
    sort: "recent" as const,
    yearFrom: sinceDate.getFullYear(),
    yearTo: now.getFullYear() + 1,
    sources: [...JOURNAL_DIGEST_SOURCES],
  };
}

export function digestSinceIso(freq: string, now = new Date(), lastRunAt?: string, sameDay = false): string {
  return digestRecencySinceIso(freq, now, lastRunAt, sameDay);
}

export function buildDigestSpec(sub: Record<string, unknown> | null | undefined, now = new Date()): QuerySpec | null {
  if (!sub) return null;
  const freq = String(sub.freq || "daily");
  const dateKey = digestDateKey(now);
  const sameDay = String(sub.todayDateKey || "") === dateKey;
  const filters = digestSpecFilters(freq, now, sub.lastRunAt as string | undefined, sameDay);
  const kind = (sub.kind as string) || "keyword";
  if (kind === "journal") {
    const j = (sub.journal as { issn?: string; name?: string }) || {};
    const value = (j.issn && String(j.issn).trim()) || (j.name && String(j.name).trim()) || String(sub.q || "").trim();
    if (!value) return null;
    return {
      groups: [{ op: "AND", terms: [{ field: "journal", value }] }],
      filters,
    };
  }
  const spec = rawToSpec(String(sub.q || ""), {});
  if (!spec.groups.length) return null;
  return {
    ...spec,
    filters: { ...spec.filters, ...filters },
  };
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

/** 发表窗起点：同日 daily 再跑时从 lastRunAt 起（仅增量），否则走 freq 默认窗 */
export function digestRecencyStartMs(
  freq: string,
  now = new Date(),
  lastRunAt?: string,
  sameDay = false,
): number {
  if (sameDay && lastRunAt && freq === "daily") {
    const last = new Date(lastRunAt).getTime();
    if (Number.isFinite(last)) return last;
  }
  return digestWindowStartMs(freq, now, lastRunAt);
}

export function digestRecencySinceIso(
  freq: string,
  now = new Date(),
  lastRunAt?: string,
  sameDay = false,
): string {
  return new Date(digestRecencyStartMs(freq, now, lastRunAt, sameDay)).toISOString().slice(0, 10);
}

/** 按发表日期收窄候选；缺 pubDate 的条目不保留（避免高相关旧文混入每日简报） */
export function filterDigestRecency(
  papers: Paper[],
  freq: string,
  now = new Date(),
  lastRunAt?: string,
  sameDay = false,
): Paper[] {
  const since = digestRecencyStartMs(freq, now, lastRunAt, sameDay);
  return papers.filter((p) => {
    if (!p.pubDate) return false;
    const t = new Date(p.pubDate).getTime();
    return Number.isFinite(t) && t >= since;
  });
}

/**
 * 简报质量闸（确定性）：去掉撤稿、无有效信息、关键词订阅里标题对不上检索式的薄条目。
 * 放在发表窗之后、seen 去重之前。
 */
export function filterDigestQuality(
  papers: Paper[],
  sub: Record<string, unknown> | null | undefined,
  spec: QuerySpec | null,
): Paper[] {
  const kind = String(sub?.kind || "keyword");
  const qTerms = kind === "keyword" && spec
    ? tokenize(specToRaw(spec)).filter((t) => t.length >= 3)
    : [];
  return papers.filter((p) => {
    if (p.retracted) return false;
    const title = String(p.title || "").trim();
    if (title.length < 8 || /^(untitled|no title|\(无标题\))/i.test(title)) return false;
    const abs = String(p.abstract || "").trim();
    const hasBody = abs.length >= 40;
    const hasIds = !!(p.doi || p.pmid);
    const hasMeta = !!String(p.journal || "").trim() && Array.isArray(p.authors) && p.authors.length > 0;
    if (!hasBody && !hasIds && !hasMeta) return false;
    if (sub?.hideNoAbstract === true && !hasBody && !hasIds) return false;
    // 关键词订阅：仅有标题壳子时，标题须命中检索词之一
    if (kind === "keyword" && qTerms.length > 0 && !hasBody && !hasIds) {
      const t = title.toLowerCase();
      if (!qTerms.some((w) => t.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => {
    const score = (p: Paper) => ((p.abstract || "").trim().length >= 40 ? 1 : 0);
    return score(b) - score(a);
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

/**
 * 简报列表：today 内嵌条目可能缺 abstract（旧快照/截断），从 papers 库补齐后再展示。
 */
export function enrichDigestPaper(
  paper: Paper,
  lookup?: (id: string) => Paper | undefined | null,
): Paper {
  if (!paper?.id || !lookup) return paper;
  const stored = lookup(paper.id);
  if (!stored) return paper;
  const absToday = String(paper.abstract || "").trim();
  const absStored = String(stored.abstract || "").trim();
  if (absToday) return paper;
  if (!absStored) return paper;
  return { ...paper, abstract: stored.abstract };
}

export function enrichSubscriptionToday(
  sub: Record<string, unknown>,
  lookup: (id: string) => Paper | undefined | null,
): Record<string, unknown> {
  const today = todayPaperList(sub).map((p) => enrichDigestPaper(p, lookup));
  if (!today.length) return sub;
  return { ...sub, today };
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
  qualityDropped?: number;
  ai?: import("./digest-ai.ts").DigestAiMeta;
}

export function freshHits(all: Paper[], seenIds: string[], extra?: { ids?: string[]; dois?: string[] }): Paper[] {
  const seen = new Set(seenIds);
  for (const id of extra?.ids ?? []) {
    if (id) seen.add(id);
  }
  const seenDois = new Set((extra?.dois ?? []).map((d) => String(d).toLowerCase()).filter(Boolean));
  return all.filter((p) => {
    if (seen.has(p.id)) return false;
    const doi = p.doi ? String(p.doi).toLowerCase() : "";
    if (doi && seenDois.has(doi)) return false;
    return true;
  });
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
