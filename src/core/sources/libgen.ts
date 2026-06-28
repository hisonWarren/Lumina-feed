// USP · LibGen 搜索适配器（HTML 镜像，与 fetch 链共用 alt-sources 解析）
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { parseIdentifier } from "../locate/parse-identifier.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { searchLibgenHits } from "../oa/alt-sources.ts";
import { fetchWithRetry } from "./rate-limit.ts";

export const libgenAdapter: SourceAdapter = {
  id: "libgen",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const raw = (q.raw ?? ctx.q).trim();
    const id = parseIdentifier(raw);
    const column = id?.kind === "doi" ? "doi" : ctx.field === "title" ? "title" : ctx.field === "author" ? "author" : undefined;
    const query = id?.kind === "doi" ? id.normalized : ctx.q;
    if (!query) return [];

    const f = opts.fetchImpl ?? fetch;
    const wrapped = (url: string, init?: RequestInit) =>
      fetchWithRetry("libgen", url, init ?? {}, f, { signal: opts.signal });

    return searchLibgenHits(query, {
      column,
      limit: opts.limit ?? 25,
      fetchImpl: wrapped as typeof fetch,
      signal: opts.signal,
    });
  },
};
