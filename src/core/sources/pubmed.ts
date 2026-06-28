// lumina-feed · PubMed (E-utilities) 适配器
// 默认 sort=relevance (Best Match)；字段化 term 修标题检索。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { SOURCE_BUILDERS } from "../search/query-spec.ts";
import { searchContext } from "../search/search-context.ts";
import { type SourceAdapter, type SearchOpts, getJson, getPoliteIdentity, yearOf } from "./adapter.ts";
import { registerLimiter } from "./rate-limit.ts";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export function parsePubmedSummary(json: any): SearchHit[] {
  const result = json?.result;
  if (!result) return [];
  const uids: string[] = result.uids ?? [];
  return uids.map((uid) => {
    const d = result[uid] ?? {};
    const ids: any[] = d.articleids ?? [];
    const doi = ids.find((x) => x.idtype === "doi")?.value;
    const pubDate = normalizeDate(d.sortpubdate || d.pubdate);
    return {
      source: "pubmed",
      pmid: uid,
      doi,
      title: (d.title ?? "").replace(/\.$/, ""),
      authors: (d.authors ?? []).map((a: any) => a.name).filter(Boolean),
      journal: d.fulljournalname || d.source,
      year: yearOf(pubDate),
      pubDate,
      isPreprint: false,
      peerReviewed: true,
      retracted: /retract/i.test(d.title ?? ""),
      citationCount: undefined,
    } as SearchHit;
  });
}

function normalizeDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\//g, "-").split(" ")[0];
  const d = new Date(t);
  return isNaN(+d) ? undefined : d.toISOString().slice(0, 10);
}

export const pubmedAdapter: SourceAdapter = {
  id: "pubmed",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const { tool, email } = getPoliteIdentity();
    const ctx = searchContext(q, opts);
    const built = SOURCE_BUILDERS.pubmed(ctx.q, ctx.field, ctx.sort, ctx.years);
    const limit = opts.limit ?? 25;
    const ncbiKey = opts.keys?.ncbi;
    registerLimiter("pubmed", ncbiKey ? 110 : 350);
    const sp = new URLSearchParams({ ...built.params, retmax: String(limit) });
    if (tool) sp.set("tool", tool);
    if (email) sp.set("email", email);
    if (ncbiKey) sp.set("api_key", ncbiKey);
    if (opts.since) {
      sp.set("mindate", opts.since.slice(0, 10).replace(/-/g, "/"));
      sp.set("datetype", "pdat");
      sp.set("maxdate", "3000/12/31");
    }
    const es = await getJson(`${EUTILS}/esearch.fcgi?${sp}`, opts);
    const ids: string[] = es?.esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    const ss = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" });
    if (tool) ss.set("tool", tool);
    if (email) ss.set("email", email);
    if (ncbiKey) ss.set("api_key", ncbiKey);
    const sum = await getJson(`${EUTILS}/esummary.fcgi?${ss}`, opts);
    return parsePubmedSummary(sum);
  },
};
