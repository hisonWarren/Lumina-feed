// lumina-feed · PubMed (E-utilities) 适配器
// ESearch(取 id 列表) → ESummary(取 docsum)。带 tool+email；有 key 可 ≤10 req/s。
// 摘要需 EFetch(XML)，较重；digest 用 summary 字段足够，abstract 留空由 Europe PMC/Crossref 补。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { toPubmedTerm } from "../querySpec.ts";
import { type SourceAdapter, type SearchOpts, getJson, getPoliteIdentity, yearOf } from "./adapter.ts";

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
  // "2026/06/25 00:00" or "2026 Jun 25" → ISO date
  const t = s.replace(/\//g, "-").split(" ")[0];
  const d = new Date(t);
  return isNaN(+d) ? undefined : d.toISOString().slice(0, 10);
}

export const pubmedAdapter: SourceAdapter = {
  id: "pubmed",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const { tool, email } = getPoliteIdentity();
    const term = toPubmedTerm(q);
    const limit = opts.limit ?? 25;
    const sp = new URLSearchParams({ db: "pubmed", term, retmax: String(limit), retmode: "json", sort: "date" });
    if (tool) sp.set("tool", tool); if (email) sp.set("email", email);
    if (opts.since) sp.set("mindate", opts.since.slice(0, 10).replace(/-/g, "/")), sp.set("datetype", "pdat"), sp.set("maxdate", "3000/12/31");
    const es = await getJson(`${EUTILS}/esearch.fcgi?${sp}`, opts);
    const ids: string[] = es?.esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    const ss = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" });
    if (tool) ss.set("tool", tool); if (email) ss.set("email", email);
    const sum = await getJson(`${EUTILS}/esummary.fcgi?${ss}`, opts);
    return parsePubmedSummary(sum);
  },
};
