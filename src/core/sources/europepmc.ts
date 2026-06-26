// lumina-feed · Europe PMC 适配器（M1 · 统一吐 SearchHit）
// REST search?query=...&format=json&resultType=core；OA 全文定位强，含 preprint(source=PPR)。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { toEuropePmcQuery } from "../querySpec.ts";
import { type SourceAdapter, type SearchOpts, getJson, getPoliteIdentity, yearOf } from "./adapter.ts";

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export function parseEuropePmc(json: any): SearchHit[] {
  const results: any[] = json?.resultList?.result ?? [];
  return results.map((r) => {
    const isPreprint = r.source === "PPR" || /preprint/i.test(r.pubType ?? "");
    const urls = r.fullTextUrlList?.fullTextUrl ?? [];
    const oa = urls.find((u: any) => u.availabilityCode === "OA" && u.documentStyle === "html") ?? urls.find((u: any) => u.availabilityCode === "OA");
    return {
      source: "europepmc",
      doi: (r.doi ?? "").toLowerCase() || undefined,
      pmid: r.pmid,
      pmcid: r.pmcid,
      title: r.title,
      abstract: r.abstractText,
      authors: r.authorString ? r.authorString.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
      journal: r.journalTitle || (isPreprint ? "Preprint" : undefined),
      year: r.pubYear ? parseInt(r.pubYear, 10) : yearOf(r.firstPublicationDate),
      pubDate: r.firstPublicationDate,
      isPreprint,
      peerReviewed: !isPreprint,
      oaStatus: r.isOpenAccess === "Y" ? "open" : undefined,
      oaUrl: oa?.url,
      citationCount: r.citedByCount,
    } as SearchHit;
  }).filter((h) => h.title);
}

export const europepmcAdapter: SourceAdapter = {
  id: "europepmc",
  async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
    const params = new URLSearchParams({ query: toEuropePmcQuery(q), format: "json", resultType: "core", pageSize: String(opts.limit ?? 25), sort: "P_PDATE_D desc" });
    const { email } = getPoliteIdentity();
    if (email) params.set("email", email);
    const json = await getJson(`${API}/search?${params}`, opts);
    let hits = parseEuropePmc(json);
    if (opts.since) { const s = new Date(opts.since).getTime(); hits = hits.filter((h) => !h.pubDate || new Date(h.pubDate).getTime() >= s); }
    return hits;
  },
};

// ── M5 兼容层：searchEuropePmc（返回 DigestItem，供自托管 worker / 调度推送复用）──
// 合规：单次礼貌请求 + email 署名 + 仅取元数据；全文获取另走合法 OA 解析（不在此）。
import type { DigestItem } from "../schedule/types.ts";

export interface QueryLike {
  /** 原始 Europe PMC 检索式（如 "heart failure AND SGLT2"）；或由结构化 QuerySpec 编译得到 */
  raw?: string;
  terms?: string[];
}

export interface EpmcOptions {
  email?: string;       // 礼貌署名（建议提供）
  pageSize?: number;    // 默认 25
  sinceISO?: string | null; // 仅保留 firstPublicationDate >= since
  fetchImpl?: typeof fetch;
  baseUrl?: string;     // 便于测试注入
}

function toQuery(q: QueryLike): string {
  if (q.raw && q.raw.trim()) return q.raw.trim();
  if (q.terms?.length) return q.terms.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" AND ");
  return "*";
}

interface EpmcResult {
  id?: string; source?: string; pmid?: string; doi?: string; title?: string;
  authorString?: string; journalTitle?: string; pubYear?: string;
  firstPublicationDate?: string; isOpenAccess?: string; pubType?: string;
  fullTextUrlList?: { fullTextUrl?: Array<{ url?: string; documentStyle?: string; availabilityCode?: string }> };
}

export async function searchEuropePmc(q: QueryLike, opts: EpmcOptions = {}): Promise<DigestItem[]> {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? "https://www.ebi.ac.uk/europepmc/webservices/rest";
  const params = new URLSearchParams({
    query: toQuery(q),
    format: "json",
    resultType: "core",
    pageSize: String(opts.pageSize ?? 25),
    sort: "P_PDATE_D desc", // 按首次发表日期降序
  });
  if (opts.email) params.set("email", opts.email);

  const res = await f(`${base}/search?${params.toString()}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}`);
  const data: any = await res.json();
  const results: EpmcResult[] = data?.resultList?.result ?? [];

  const since = opts.sinceISO ? new Date(opts.sinceISO).getTime() : null;
  const out: DigestItem[] = [];
  for (const r of results) {
    const pub = r.firstPublicationDate ? new Date(r.firstPublicationDate).getTime() : null;
    if (since != null && pub != null && pub < since) continue; // 仅新于 lastRun
    const isPreprint = (r.source === "PPR") || /preprint/i.test(r.pubType ?? "");
    out.push({
      id: r.doi || (r.source && r.id ? `${r.source}:${r.id}` : r.pmid || r.title || Math.random().toString(36)),
      title: r.title ?? "(无标题)",
      authors: r.authorString ? r.authorString.split(",").map((s) => s.trim()).slice(0, 6) : undefined,
      journal: r.journalTitle || (isPreprint ? "Preprint" : undefined),
      year: r.pubYear ? parseInt(r.pubYear, 10) : undefined,
      doi: r.doi,
      url: pickUrl(r) ?? (r.doi ? `https://doi.org/${r.doi}` : undefined),
      isPreprint,
      type: isPreprint ? "preprint" : undefined,
      sourceBasis: null, // 总结阶段再填（基于全文/摘要）
    });
  }
  return out;
}

function pickUrl(r: EpmcResult): string | undefined {
  const urls = r.fullTextUrlList?.fullTextUrl ?? [];
  // 优先 OA 全文 HTML/PDF
  const oa = urls.find((u) => u.availabilityCode === "OA" && u.documentStyle === "html")
    ?? urls.find((u) => u.availabilityCode === "OA")
    ?? urls[0];
  return oa?.url;
}
