// lumina-feed · OpenAIRE Graph 出版物检索
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { searchContext } from "../search/search-context.ts";
import { openaire as buildOA } from "../search/query-spec-ext.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";
import { fetchWithRetry } from "./rate-limit.ts";

const API = "https://api.openaire.eu/search/publications";

function pickTitle(m: any): string | undefined {
  return m?.title?.[0]?.$ ?? m?.title?.[0] ?? (typeof m?.title === "string" ? m.title : undefined);
}

function pickAbstract(m: any): string | undefined {
  const d = m?.description ?? m?.abstract;
  if (Array.isArray(d)) return d[0]?.$ ?? d[0];
  return typeof d === "string" ? d : undefined;
}

function pickDoi(m: any): string | undefined {
  const pid = m?.pid ?? m?.pids?.pid ?? [];
  const list = Array.isArray(pid) ? pid : pid ? [pid] : [];
  const doi = list.find((p: any) => String(p?.classid ?? p?.["@classid"] ?? "").toLowerCase().includes("doi"))
    ?? (pid && !Array.isArray(pid) && String(pid?.["@classid"] ?? pid?.classid ?? "").toLowerCase().includes("doi") ? pid : null);
  const val = doi?.$ ?? doi?.value ?? doi;
  if (!val || typeof val === "object") return undefined;
  return String(val).toLowerCase().replace(/^https?:\/\/doi\.org\//, "");
}

function unwrapOpenaireMetadata(r: any): any {
  const meta = r?.metadata;
  if (!meta) return r;
  const entity = meta["oaf:entity"] ?? meta.oaf?.entity;
  if (entity) return entity["oaf:result"] ?? entity.oaf?.result ?? entity;
  return meta;
}

function pickAuthors(m: any): string[] {
  const creators = m?.creator ?? m?.creators?.creator ?? [];
  const list = Array.isArray(creators) ? creators : [creators];
  return list.map((c: any) => c?.name?.$ ?? c?.name ?? c?.$ ?? c).filter(Boolean);
}

function pickOaUrl(m: any): string | undefined {
  const inst = m?.instance ?? m?.instances?.instance ?? [];
  const list = Array.isArray(inst) ? inst : [inst];
  for (const i of list) {
    const url = i?.webresource?.url?.$ ?? i?.webresource?.url ?? i?.url?.$ ?? i?.url;
    if (url && /\.pdf|fulltext|download/i.test(String(url))) return String(url);
  }
  const ws = m?.bestaccessright?.label ?? m?.accessrights;
  if (ws && /open/i.test(String(ws))) {
    const u = list[0]?.webresource?.url?.$ ?? list[0]?.url;
    if (u) return String(u);
  }
  return undefined;
}

export function parseOpenaire(json: any): SearchHit[] {
  const results = json?.response?.results?.result ?? json?.results?.result ?? [];
  const list = Array.isArray(results) ? results : [results];
  return list.map((r: any) => {
    const m = unwrapOpenaireMetadata(r);
    const year = Number(m?.dateofacceptance?.$?.slice?.(0, 4) ?? m?.year ?? m?.publicationdate?.$?.slice?.(0, 4));
    const oaUrl = pickOaUrl(m);
    return {
      source: "openaire",
      doi: pickDoi(m),
      title: pickTitle(m),
      abstract: pickAbstract(m),
      authors: pickAuthors(m),
      year: Number.isFinite(year) ? year : undefined,
      isPreprint: /preprint|submitted/i.test(String(m?.type ?? "")),
      peerReviewed: !/preprint/i.test(String(m?.type ?? "")),
      oaUrl,
      oaStatus: oaUrl ? "green" : undefined,
    } as SearchHit;
  }).filter((h: SearchHit) => h.title);
}

export const openaireAdapter: SourceAdapter = {
  id: "openaire",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const ctx = searchContext(q, opts);
    const built = buildOA(ctx.q, ctx.field);
    const p = new URLSearchParams({
      keywords: built.params.keywords,
      size: String(Math.min(50, opts.limit ?? 25)),
      format: "json",
    });
    const f = opts.fetchImpl ?? fetch;
    const res = await fetchWithRetry("openaire", `${API}?${p}`, { headers: { accept: "application/json" }, signal: opts.signal }, f);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ api.openaire.eu`);
    return parseOpenaire(await res.json());
  },
};
