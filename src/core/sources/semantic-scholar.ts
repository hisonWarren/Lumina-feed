// src/core/sources/semantic-scholar.ts — Semantic Scholar adapter (P1).
// /graph/v1/paper/search (relevance ranker). Key OPTIONAL via keychain `semanticscholar_key`
// (x-api-key header) for higher rate; unauth pool needs backoff (fetchWithRetry handles it).
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { semanticscholar as buildS2 } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://api.semanticscholar.org/graph/v1/paper/search";

export function parseSemanticScholar(json: any): (SearchHit & { s2Id?: string })[] {
  const data: any[] = json?.data ?? [];
  return data.map((w) => {
    const ids = w.externalIds ?? {};
    const types: string[] = w.publicationTypes ?? [];
    const isPreprint = types.includes("Preprint") || (!!w.venue && /arxiv|biorxiv|medrxiv|ssrn|preprint/i.test(String(w.venue)));
    return {
      source: "semanticscholar",
      s2Id: w.paperId,
      doi: ids.DOI ? String(ids.DOI).toLowerCase() : undefined,
      pmid: ids.PubMed ? String(ids.PubMed) : undefined,
      arxivId: ids.ArXiv ? String(ids.ArXiv) : undefined,
      title: w.title,
      abstract: w.abstract || undefined,
      authors: (w.authors ?? []).map((a: any) => a?.name).filter(Boolean),
      journal: w.venue || undefined,
      year: w.year,
      pubDate: w.publicationDate || undefined,
      isPreprint,
      peerReviewed: !isPreprint,
      citationCount: w.citationCount,
      oaUrl: w.openAccessPdf?.url || undefined,
      oaStatus: w.openAccessPdf?.url ? "green" : undefined,
    } as SearchHit & { s2Id?: string };
  }).filter((h) => h.title);
}

export const semanticScholarAdapter: SourceAdapter = {
  id: "semanticscholar",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildS2(ctx.q, ctx.field, ctx.sort, ctx.years);
    const p = new URLSearchParams(built.params);
    p.set("limit", String(Math.min(100, opts.limit ?? 25)));
    const key = (opts as any).keys?.semanticscholar as string | undefined;
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers["x-api-key"] = key;
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("semanticscholar", `${API}?${p}`, { headers, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ api.semanticscholar.org`);
    let hits = parseSemanticScholar(await res.json());
    if (opts.since) {
      const s = new Date(opts.since).getTime();
      hits = hits.filter((h) => h.pubDate && new Date(h.pubDate).getTime() >= s);
    }
    return hits;
  },
};
