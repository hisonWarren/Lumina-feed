// lumina-feed · CORE 仓储检索（需 core_key）
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { core as buildCore } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://api.core.ac.uk/v3/search/works";

export function parseCore(json: any): SearchHit[] {
  return (json?.results ?? []).map((w: any) => ({
    source: "core",
    doi: w.doi ? String(w.doi).toLowerCase().replace(/^https?:\/\/doi\.org\//, "") : undefined,
    title: w.title,
    abstract: w.abstract || undefined,
    authors: (w.authors ?? []).map((a: any) => (typeof a === "string" ? a : a?.name)).filter(Boolean),
    journal: w.publisher || w.journals?.[0]?.title,
    year: w.yearPublished ? Number(w.yearPublished) : undefined,
    isPreprint: false,
    peerReviewed: true,
    oaStatus: w.downloadUrl ? "green" : undefined,
    oaUrl: w.downloadUrl || undefined,
  } as SearchHit)).filter((h: SearchHit) => h.title);
}

export const coreAdapter: SourceAdapter = {
  id: "core",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const key = opts.keys?.core;
    if (!key) return [];
    const ctx = searchContext(q, opts);
    const built = buildCore(ctx.q, ctx.field, ctx.sort, ctx.years);
    const p = new URLSearchParams({ q: built.params.q, limit: String(Math.min(50, opts.limit ?? 25)) });
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("core", `${API}?${p}`, {
      headers: { accept: "application/json", Authorization: `Bearer ${key}` },
      signal: opts.signal,
    }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ api.core.ac.uk`);
    return parseCore(await res.json());
  },
};
