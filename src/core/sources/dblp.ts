// lumina-feed · DBLP CS 会议/期刊
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { dblp as buildDblp } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://dblp.org/search/publ/api";

export function parseDblp(json: any): SearchHit[] {
  const hits = json?.result?.hits?.hit ?? [];
  const list = Array.isArray(hits) ? hits : [hits];
  return list.map((h: any) => {
    const info = h.info ?? {};
    const authors = String(info.authors?.author ?? info.author ?? "")
      .split("|").map((s) => s.trim()).filter(Boolean);
    if (!authors.length && info.authors?.author) {
      const a = info.authors.author;
      authors.push(...(Array.isArray(a) ? a : [a]));
    }
    const doi = info.doi || info.ee?.find?.((e: string) => /doi\.org/i.test(e));
    const doiNorm = doi ? String(doi).replace(/^https?:\/\/doi\.org\//, "").toLowerCase() : undefined;
    return {
      source: "dblp",
      doi: doiNorm,
      title: info.title,
      authors,
      journal: info.venue,
      year: info.year ? Number(info.year) : undefined,
      isPreprint: false,
      peerReviewed: true,
      oaUrl: Array.isArray(info.ee) ? info.ee.find((e: string) => /^https?:\/\//.test(e)) : info.ee,
    } as SearchHit;
  }).filter((h: SearchHit) => h.title);
}

export const dblpAdapter: SourceAdapter = {
  id: "dblp",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildDblp(ctx.q, ctx.field);
    const p = new URLSearchParams({ q: built.params.q, format: "json", h: String(Math.min(50, opts.limit ?? 25)) });
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("dblp", `${API}?${p}`, { headers: { accept: "application/json" }, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ dblp.org`);
    return parseDblp(await res.json());
  },
};
