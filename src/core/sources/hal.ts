// lumina-feed · HAL 欧洲开放仓储
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { hal as buildHal } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://api.archives-ouvertes.fr/search/";
const FL = "title_s,abstract_s,authFullName_s,doiId_s,publicationDateY_i,uri_s,fileMain_s,submitType_s";

export function parseHal(json: any): SearchHit[] {
  return (json?.response?.docs ?? []).map((d: any) => {
    const title = Array.isArray(d.title_s) ? d.title_s[0] : d.title_s;
    const doiRaw = Array.isArray(d.doiId_s) ? d.doiId_s[0] : d.doiId_s;
    const fileMain = Array.isArray(d.fileMain_s) ? d.fileMain_s[0] : d.fileMain_s;
    const isPreprint = d.submitType_s === "file" && !doiRaw;
    return {
      source: "hal",
      doi: doiRaw ? String(doiRaw).toLowerCase() : undefined,
      title,
      abstract: Array.isArray(d.abstract_s) ? d.abstract_s[0] : d.abstract_s,
      authors: Array.isArray(d.authFullName_s) ? d.authFullName_s : (d.authFullName_s ? [d.authFullName_s] : []),
      year: d.publicationDateY_i ? Number(d.publicationDateY_i) : undefined,
      isPreprint,
      peerReviewed: !isPreprint,
      oaUrl: fileMain || (Array.isArray(d.uri_s) ? d.uri_s[0] : d.uri_s),
      oaStatus: fileMain ? "green" : undefined,
    } as SearchHit;
  }).filter((h: SearchHit) => h.title);
}

export const halAdapter: SourceAdapter = {
  id: "hal",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildHal(ctx.q, ctx.field);
    const p = new URLSearchParams({
      q: built.params.q,
      wt: "json",
      rows: String(Math.min(50, opts.limit ?? 25)),
      fl: FL,
    });
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("hal", `${API}?${p}`, { headers: { accept: "application/json" }, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ api.archives-ouvertes.fr`);
    return parseHal(await res.json());
  },
};
