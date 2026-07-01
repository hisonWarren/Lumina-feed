// lumina-feed · OSF Preprints（社科/心理预印本）
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { osf as buildOsf } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://api.osf.io/v2/preprints/";

/** OSF 预印本 id（如 jfrwu_v1）→ 项目直链下载（经 302 到 files.osf.io PDF） */
export function osfPreprintDownloadUrl(preprintId?: string): string | undefined {
  if (!preprintId) return undefined;
  const guid = String(preprintId).replace(/_v\d+$/i, "");
  return /^[a-z0-9]+$/i.test(guid) ? `https://osf.io/${guid}/download` : undefined;
}

/** PsyArXiv / OSF 预印本 DOI（10.31234/osf.io/…）→ 同上 */
export function osfDoiDownloadUrl(doi?: string): string | undefined {
  const d = String(doi || "").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  const m = /^10\.31234\/osf\.io\/([a-z0-9]+)(?:_v\d+)?$/i.exec(d);
  return m ? `https://osf.io/${m[1]}/download` : undefined;
}

/** 检索/合并阶段误存的 OSF 落地页 HTML → 可抓取的 download 直链 */
export function normalizeOsfFetchUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!/(^|\.)osf\.io$/i.test(u.host)) return url;
    const fromPreprint = /\/preprints\/[^/]+\/([a-z0-9]+)_v\d+/i.exec(u.pathname);
    if (fromPreprint) return `https://osf.io/${fromPreprint[1]}/download`;
    if (/\/preprints\//i.test(u.pathname) && !/download/i.test(u.pathname)) return undefined;
    return url;
  } catch {
    return url;
  }
}

export function parseOsf(json: any): SearchHit[] {
  const embeds = json?.embeds?.contributors?.data ?? [];
  const embedAuthors = embeds.map((c: any) => c?.attributes?.full_name).filter(Boolean);

  return (json?.data ?? []).map((item: any, i: number) => {
    const a = item.attributes ?? {};
    const links = item.links ?? {};
    const rel = item.relationships?.contributors?.data ?? [];
    const doi = links.preprint_doi || a.doi;
    const pub = a.date_published || a.date_modified;
    const year = pub ? new Date(pub).getUTCFullYear() : undefined;
    let authors: string[] = [];
    if (Array.isArray(rel) && rel.length && embeds.length) {
      authors = rel.map((r: any) => embeds.find((e: any) => e.id === r.id)?.attributes?.full_name).filter(Boolean);
    }
    if (!authors.length && embedAuthors.length) authors = embedAuthors;
    return {
      source: "osf",
      doi: doi ? String(doi).toLowerCase().replace(/^https?:\/\/doi\.org\//, "") : undefined,
      title: a.title,
      abstract: a.description || undefined,
      authors,
      year,
      pubDate: pub,
      isPreprint: true,
      peerReviewed: false,
      oaUrl: links.download || osfPreprintDownloadUrl(item.id),
      oaStatus: "gold",
    } as SearchHit;
  }).filter((h: SearchHit) => h.title);
}

export const osfAdapter: SourceAdapter = {
  id: "osf",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildOsf(ctx.q, ctx.field);
    // OSF preprints API has no filter[q]; title search is the stable public filter.
    const filterKey = ctx.field === "author" ? "filter[author]" : "filter[title]";
    const p = new URLSearchParams({
      [filterKey]: built.params.q,
      "page[size]": String(Math.min(50, opts.limit ?? 25)),
      embed: "contributors",
    });
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("osf", `${API}?${p}`, { headers: { accept: "application/json" }, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ api.osf.io`);
    return parseOsf(await res.json());
  },
};
