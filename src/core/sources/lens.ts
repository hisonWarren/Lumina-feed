// lumina-feed · Lens.org 学术检索（需 lens_token）
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { lensQuery } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://api.lens.org/scholarly/search";

export function parseLens(json: any): SearchHit[] {
  return (json?.data ?? []).map((w: any) => {
    const ext = w.external_ids ?? w.externalIds ?? [];
    const doiEntry = Array.isArray(ext)
      ? ext.find((e: any) => String(e.type ?? e.idType ?? "").toLowerCase() === "doi")
      : undefined;
    const doi = doiEntry?.value ?? doiEntry?.id ?? w.doi;
    const oaPdf = w.open_access?.oa_url ?? w.openAccess?.url;
    return {
      source: "lens",
      doi: doi ? String(doi).toLowerCase().replace(/^https?:\/\/doi\.org\//, "") : undefined,
      title: w.title ?? w.display_name,
      abstract: w.abstract ?? w.snippet,
      authors: (w.authors ?? w.author ?? []).map((a: any) => a?.name ?? a).filter(Boolean),
      journal: w.source?.title ?? w.journal?.title,
      year: w.year_published ?? w.yearPublished ?? w.publication_year,
      citationCount: w.citation_count ?? w.citationCount,
      oaUrl: oaPdf || undefined,
      oaStatus: oaPdf ? "green" : undefined,
      isPreprint: /preprint/i.test(String(w.doc_type ?? w.documentType ?? "")),
      peerReviewed: !/preprint/i.test(String(w.doc_type ?? "")),
    } as SearchHit;
  }).filter((h: SearchHit) => h.title);
}

export const lensAdapter: SourceAdapter = {
  id: "lens",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const token = opts.keys?.lens;
    if (!token) return [];
    const ctx = searchContext(q, opts);
    const body = {
      ...lensQuery(ctx.q, ctx.field),
      size: Math.min(50, opts.limit ?? 25),
      include: ["title", "abstract", "authors", "external_ids", "year_published", "source", "open_access"],
    };
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("lens", API, {
      method: "POST",
      headers: { accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ api.lens.org`);
    return parseLens(await res.json());
  },
};
