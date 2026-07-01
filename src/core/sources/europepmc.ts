// lumina-feed · Europe PMC 适配器
// 默认 relevance（omit sort）；recent/cited 时显式 sort。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { SOURCE_BUILDERS } from "../search/query-spec.ts";
import { searchContext } from "../search/search-context.ts";
import { type SourceAdapter, type SearchOpts, getJson, getPoliteIdentity, yearOf } from "./adapter.ts";
import { pickEuropePmcOaUrl } from "../oa/oa-url-normalize.ts";

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export function parseEuropePmc(json: any): SearchHit[] {
  const results: any[] = json?.resultList?.result ?? [];
  return results.map((r) => {
    const isPreprint = r.source === "PPR" || /preprint/i.test(r.pubType ?? "");
    const urls = r.fullTextUrlList?.fullTextUrl ?? [];
    return {
      source: "europepmc",
      doi: (r.doi ?? "").toLowerCase() || undefined,
      pmid: r.pmid,
      pmcid: r.pmcid,
      title: r.title,
      abstract: r.abstractText,
      authors: r.authorString ? r.authorString.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
      journal: r.journalTitle || (isPreprint ? "Preprint" : undefined),
      year: r.pubYear ? parseInt(r.pubYear, 10) : yearOf(r.firstPublicationDate),
      pubDate: r.firstPublicationDate,
      isPreprint,
      peerReviewed: !isPreprint,
      oaStatus: r.isOpenAccess === "Y" ? "open" : undefined,
      oaUrl: pickEuropePmcOaUrl(urls),
      citationCount: r.citedByCount != null && r.citedByCount !== "" ? Number(r.citedByCount) : undefined,
    } as SearchHit;
  }).filter((h) => h.title);
}

export const europepmcAdapter: SourceAdapter = {
  id: "europepmc",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = SOURCE_BUILDERS.europepmc(ctx.q, ctx.field, ctx.sort, ctx.years);
    const params = new URLSearchParams({ ...built.params, pageSize: String(opts.limit ?? 25) });
    const { email } = getPoliteIdentity();
    if (email) params.set("email", email);
    const json = await getJson(`${API}/search?${params}`, opts);
    let hits = parseEuropePmc(json);
    if (opts.since) {
      const s = new Date(opts.since).getTime();
      hits = hits.filter((h) => !h.pubDate || new Date(h.pubDate).getTime() >= s);
    }
    return hits;
  },
};
