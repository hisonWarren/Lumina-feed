// USP · Anna's Archive 搜索适配器
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { parseIdentifier } from "../locate/parse-identifier.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { searchAnnasKeywordHits } from "../oa/alt-sources.ts";
import { fetchWithRetry } from "./rate-limit.ts";

export const annasAdapter: SourceAdapter = {
  id: "annas",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const raw = (q.raw ?? ctx.q).trim();
    const id = parseIdentifier(raw);
    const query = id?.kind === "doi" ? `doi:${id.normalized}` : ctx.q;
    if (!query) return [];

    const f = opts.fetchImpl ?? fetch;
    const wrapped = (url: string, init?: RequestInit) =>
      fetchWithRetry("annas", url, init ?? {}, f, { signal: opts.signal });

    return searchAnnasKeywordHits(query, {
      limit: opts.limit ?? 25,
      fetchImpl: wrapped as typeof fetch,
      signal: opts.signal,
    });
  },
};
