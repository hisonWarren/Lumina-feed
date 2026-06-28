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
export function normalizeSubscription(sub: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!sub || typeof sub !== "object") return { schemaVersion: 2, kind: "keyword", q: "", seenIds: [], today: [] };
  return {
    schemaVersion: 2,
    sortMode: "relevance",
    autoSummarize: "blurb",
    enabled: true,
    freq: "daily",
    time: "08:00",
    ...sub,
    seenIds: Array.isArray(sub.seenIds) ? sub.seenIds : [],
    today: Array.isArray(sub.today) ? sub.today : [],
  };
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
