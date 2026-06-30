// lumina-feed · Crossref 适配器
// 默认 relevance；recent/cited 时显式 sort。
import type { SearchHit, StudyType } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { SOURCE_BUILDERS } from "../search/query-spec.ts";
import { searchContext } from "../search/search-context.ts";
import { type SourceAdapter, type SearchOpts, getJson, getPoliteIdentity } from "./adapter.ts";

const API = "https://api.crossref.org/works";

const TYPE_MAP: Record<string, StudyType> = {
  "journal-article": "other", "posted-content": "preprint", "proceedings-article": "other",
  "book-chapter": "other", "review-article": "review",
};

export function parseCrossref(json: any): SearchHit[] {
  const items: any[] = json?.message?.items ?? [];
  return items.map((it) => {
    const isPreprint = it.type === "posted-content" || (it.subtype === "preprint");
    const parts = it.issued?.["date-parts"]?.[0] ?? it["published"]?.["date-parts"]?.[0];
    const year = parts?.[0];
    const pubDate = parts ? `${parts[0]}-${String(parts[1] ?? 1).padStart(2, "0")}-${String(parts[2] ?? 1).padStart(2, "0")}` : undefined;
    const rel = it.relation?.["is-preprint-of"]?.[0]?.id || it.relation?.["has-preprint"]?.[0]?.id;
    return {
      source: "crossref",
      doi: (it.DOI ?? "").toLowerCase() || undefined,
      title: Array.isArray(it.title) ? it.title[0] : it.title,
      abstract: stripJats(it.abstract),
      authors: (it.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
      journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : it["container-title"],
      year, pubDate,
      type: [TYPE_MAP[it.type] ?? "other"],
      isPreprint,
      peerReviewed: !isPreprint && it.type === "journal-article",
      citationCount: it["is-referenced-by-count"],
      relatedDoi: typeof rel === "string" ? rel.replace(/^https?:\/\/doi\.org\//, "").toLowerCase() : undefined,
    } as SearchHit;
  }).filter((h) => h.title);
}

function stripJats(s?: string): string | undefined {
  if (!s) return undefined;
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined;
}

export const crossrefAdapter: SourceAdapter = {
  id: "crossref",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = SOURCE_BUILDERS.crossref(ctx.q, ctx.field, ctx.sort, ctx.years);
    const p = new URLSearchParams(built.params);
    p.set("rows", String(opts.limit ?? 25));
    const { email } = getPoliteIdentity();
    if (email) p.set("mailto", email);
    if (opts.since) {
      const sinceFilter = `from-pub-date:${opts.since.slice(0, 10)}`;
      const prev = p.get("filter");
      p.set("filter", prev ? `${prev},${sinceFilter}` : sinceFilter);
    }
    const json = await getJson(`${API}?${p}`, opts);
    return parseCrossref(json);
  },
};
