// src/core/sources/doaj.ts — DOAJ articles (P1). No auth. Gold-OA, peer-reviewed by definition.
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { doaj as buildDoaj } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://doaj.org/api/v3/search/articles";

export function parseDoaj(json: any): SearchHit[] {
  const results: any[] = json?.results ?? [];
  return results.map((r) => {
    const b = r.bibjson ?? {};
    const doiId = (b.identifier ?? []).find((i: any) => String(i.type).toLowerCase() === "doi")?.id;
    const ftUrl = (b.link ?? []).find((l: any) => String(l.type).toLowerCase() === "fulltext")?.url;
    const year = b.year ? Number(b.year) : undefined;
    const month = b.month ? Number(b.month) : undefined;
    let pubDate: string | undefined;
    if (year && month) {
      const day = b.day ? Number(b.day) : new Date(year, month, 0).getDate();
      pubDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return {
      source: "doaj",
      doi: doiId ? String(doiId).toLowerCase().replace(/^https?:\/\/doi\.org\//, "") : undefined,
      title: b.title,
      abstract: b.abstract || undefined,
      authors: (b.author ?? []).map((a: any) => a?.name).filter(Boolean),
      journal: b.journal?.title,
      year,
      pubDate,
      isPreprint: false,
      peerReviewed: true,
      oaStatus: "gold",
      oaUrl: ftUrl || undefined,
    } as SearchHit;
  }).filter((h) => h.title);
}

export const doajAdapter: SourceAdapter = {
  id: "doaj",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildDoaj(ctx.q, ctx.field);
    const p = new URLSearchParams({ pageSize: String(Math.min(50, opts.limit ?? 25)) });
    const f = opts.fetchImpl ?? fetch;
    const url = `${API}/${encodeURIComponent(built.path)}?${p}`;
    const res = await fetchWithRetry("doaj", url, { headers: { accept: "application/json" }, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ doaj.org`);
    let hits = parseDoaj(await res.json());
    if (opts.since) {
      const s = new Date(opts.since).getTime();
      hits = hits.filter((h) => h.pubDate && new Date(h.pubDate).getTime() >= s);
    }
    return hits;
  },
};
