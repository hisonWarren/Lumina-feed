// src/core/sources/datacite.ts — DataCite DOIs (datasets / grey literature / some preprints). No auth.
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { datacite as buildDC } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://api.datacite.org/dois";

export function parseDatacite(json: any): SearchHit[] {
  const data: any[] = json?.data ?? [];
  return data.map((d) => {
    const a = d.attributes ?? {};
    const type = String(a.types?.resourceTypeGeneral ?? "").toLowerCase();
    return {
      source: "datacite",
      doi: a.doi ? String(a.doi).toLowerCase() : undefined,
      title: (a.titles ?? [])[0]?.title,
      abstract: (a.descriptions ?? []).find((x: any) => /abstract/i.test(String(x.descriptionType)))?.description || undefined,
      authors: (a.creators ?? []).map((c: any) => c.name).filter(Boolean),
      journal: a.publisher,
      year: a.publicationYear,
      isPreprint: type === "preprint" || type === "text",
      peerReviewed: false,
      oaUrl: a.url || undefined,
    } as SearchHit;
  }).filter((h) => h.title);
}

export const dataciteAdapter: SourceAdapter = {
  id: "datacite",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildDC(ctx.q, ctx.field, ctx.sort, ctx.years);
    const p = new URLSearchParams(built.params);
    p.set("page[size]", String(Math.min(50, opts.limit ?? 25)));
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("datacite", `${API}?${p}`, { headers: { accept: "application/json" }, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ api.datacite.org`);
    return parseDatacite(await res.json());
  },
};
