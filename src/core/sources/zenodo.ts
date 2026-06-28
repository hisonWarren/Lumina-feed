// lumina-feed · Zenodo 记录（预印本/数据/软件）
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { zenodo as buildZenodo } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://zenodo.org/api/records";

export function parseZenodo(json: any): SearchHit[] {
  return (json?.hits?.hits ?? []).map((hit: any) => {
    const m = hit.metadata ?? {};
    const pdf = (hit.files ?? m.files ?? []).find((f: any) => /\.pdf$/i.test(String(f.key ?? f.filename ?? "")));
    const oaUrl = pdf?.links?.self ?? pdf?.links?.download;
    const rt = m.resource_type?.type ?? m.resource_type;
    const isPreprint = /publication-preprint|preprint|publication/i.test(String(rt));
    return {
      source: "zenodo",
      doi: m.doi ? String(m.doi).toLowerCase() : undefined,
      title: m.title,
      abstract: m.description || undefined,
      authors: (m.creators ?? []).map((c: any) => c.name).filter(Boolean),
      year: m.publication_date ? new Date(m.publication_date).getUTCFullYear() : undefined,
      pubDate: m.publication_date,
      isPreprint,
      peerReviewed: !isPreprint,
      oaUrl: oaUrl || undefined,
      oaStatus: oaUrl ? "green" : undefined,
    } as SearchHit;
  }).filter((h: SearchHit) => h.title);
}

export const zenodoAdapter: SourceAdapter = {
  id: "zenodo",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildZenodo(ctx.q, ctx.field, ctx.sort);
    const p = new URLSearchParams(built.params);
    p.set("size", String(Math.min(50, opts.limit ?? 25)));
    const headers: Record<string, string> = { accept: "application/json" };
    const token = opts.keys?.zenodo;
    if (token) headers.Authorization = `Bearer ${token}`;
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("zenodo", `${API}?${p}`, { headers, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ zenodo.org`);
    return parseZenodo(await res.json());
  },
};
