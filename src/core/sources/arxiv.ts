// lumina-feed · arXiv 适配器
// export.arxiv.org/api/query（Atom XML）。Node 无 DOM，用轻量正则解析 entry。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { toArxivQuery } from "../querySpec.ts";
import { type SourceAdapter, type SearchOpts, getText, yearOf } from "./adapter.ts";

const API = "https://export.arxiv.org/api/query";

const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1].trim()) : undefined;
};
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export function parseArxivAtom(xml: string): SearchHit[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((e) => {
    const idUrl = tag(e, "id") ?? "";
    const arxivId = idUrl.split("/abs/")[1]?.replace(/v\d+$/, "") ?? idUrl;
    const published = tag(e, "published");
    const doiM = e.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/i);
    const authors = [...e.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) => decode(m[1]));
    const pubDate = published ? published.slice(0, 10) : undefined;
    return {
      source: "arxiv",
      arxivId,
      doi: doiM ? doiM[1].toLowerCase() : undefined,
      title: tag(e, "title"),
      abstract: tag(e, "summary"),
      authors,
      journal: "arXiv",
      year: yearOf(published),
      pubDate,
      isPreprint: true,
      peerReviewed: false,
      oaUrl: idUrl.replace("/abs/", "/pdf/"),
    } as SearchHit;
  }).filter((h) => h.title);
}

export const arxivAdapter: SourceAdapter = {
  id: "arxiv",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const p = new URLSearchParams({ search_query: toArxivQuery(q), start: "0", max_results: String(opts.limit ?? 25), sortBy: "submittedDate", sortOrder: "descending" });
    const xml = await getText(`${API}?${p}`, opts);
    let hits = parseArxivAtom(xml);
    if (opts.since) { const s = new Date(opts.since).getTime(); hits = hits.filter((h) => !h.pubDate || new Date(h.pubDate).getTime() >= s); }
    return hits;
  },
};
