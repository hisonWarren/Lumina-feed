// lumina-feed · OpenAlex 适配器
// works?search=...&filter=from_publication_date:...&sort=publication_date:desc&mailto=(polite)
// 含 OA 状态、被引、概念；摘要为倒排索引需重建。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { toOpenalexParams } from "../querySpec.ts";
import { type SourceAdapter, type SearchOpts, getJson, getPoliteIdentity } from "./adapter.ts";

const API = "https://api.openalex.org/works";

export function reconstructAbstract(inv?: Record<string, number[]>): string | undefined {
  if (!inv) return undefined;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inv)) for (const pos of positions) slots[pos] = word;
  const text = slots.join(" ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

export function parseOpenalex(json: any): SearchHit[] {
  const results: any[] = json?.results ?? [];
  return results.map((w) => {
    const isPreprint = w.type === "preprint" || w.primary_location?.version === "submittedVersion";
    return {
      source: "openalex",
      doi: (w.doi ?? "").replace(/^https?:\/\/doi\.org\//, "").toLowerCase() || undefined,
      title: w.title || w.display_name,
      abstract: reconstructAbstract(w.abstract_inverted_index),
      authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
      journal: w.primary_location?.source?.display_name,
      year: w.publication_year,
      pubDate: w.publication_date,
      isPreprint,
      peerReviewed: !isPreprint,
      retracted: !!w.is_retracted,
      citationCount: w.cited_by_count,
      oaStatus: w.open_access?.oa_status,
      oaUrl: w.open_access?.oa_url || w.best_oa_location?.pdf_url || undefined,
    } as SearchHit;
  }).filter((h) => h.title);
}

export const openalexAdapter: SourceAdapter = {
  id: "openalex",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const p = toOpenalexParams(q, opts.since);
    p.set("per-page", String(opts.limit ?? 25));
    p.set("sort", "publication_date:desc");
    const { email } = getPoliteIdentity();
    if (email) p.set("mailto", email);
    const json = await getJson(`${API}?${p}`, opts);
    return parseOpenalex(json);
  },
};
