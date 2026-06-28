// lumina-feed · Europe PMC 适配器（M1 · 统一吐 SearchHit）
// REST search?query=...&format=json&resultType=core；OA 全文定位强，含 preprint(source=PPR)。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { toEuropePmcQuery } from "../querySpec.ts";
import { type SourceAdapter, type SearchOpts, getJson, getPoliteIdentity, yearOf } from "./adapter.ts";

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export function parseEuropePmc(json: any): SearchHit[] {
  const results: any[] = json?.resultList?.result ?? [];
  return results.map((r) => {
    const isPreprint = r.source === "PPR" || /preprint/i.test(r.pubType ?? "");
    const urls = r.fullTextUrlList?.fullTextUrl ?? [];
    const oa = urls.find((u: any) => u.availabilityCode === "OA" && u.documentStyle === "html") ?? urls.find((u: any) => u.availabilityCode === "OA");
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
      oaUrl: oa?.url,
      citationCount: r.citedByCount,
    } as SearchHit;
  }).filter((h) => h.title);
}

export const europepmcAdapter: SourceAdapter = {
  id: "europepmc",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const params = new URLSearchParams({ query: toEuropePmcQuery(q), format: "json", resultType: "core", pageSize: String(opts.limit ?? 25), sort: "P_PDATE_D desc" });
    const { email } = getPoliteIdentity();
    if (email) params.set("email", email);
    const json = await getJson(`${API}/search?${params}`, opts);
    let hits = parseEuropePmc(json);
    if (opts.since) { const s = new Date(opts.since).getTime(); hits = hits.filter((h) => !h.pubDate || new Date(h.pubDate).getTime() >= s); }
    return hits;
  },
};

