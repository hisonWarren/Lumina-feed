// lumina-feed · 从 QuerySpec 提取 SOURCE_BUILDERS 所需上下文
import type { QuerySpec } from "../querySpec.ts";
import { specToRaw } from "../querySpec.ts";
import type { Field, SortMode } from "./query-spec.ts";
import type { SearchOpts } from "../sources/adapter.ts";

export function searchContext(spec: QuerySpec, opts: SearchOpts = {}) {
  const field = (spec.filters.field as Field | undefined) ?? "all";
  const sort = (spec.filters.sort as SortMode | undefined) ?? "relevance";
  const years = { from: spec.filters.yearFrom, to: spec.filters.yearTo };
  const q =
    spec.groups.flatMap((g) => g.terms.map((t) => t.value)).filter(Boolean).join(" ") ||
    specToRaw(spec).replace(/\[[^\]]+\]/g, " ").replace(/\b(AND|OR|NOT)\b/gi, " ").replace(/\s+/g, " ").trim();
  return { q, field, sort, years, since: opts.since };
}
