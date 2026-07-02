// lumina-feed · OpenAlex Sources API（期刊 live 指标，免费无鉴权）
// 类影响因子 = summary_stats["2yr_mean_citedness"]（非 Clarivate JIF）。
import { getPoliteIdentity } from "../sources/adapter.ts";
import { normalizeIssn } from "./issn.ts";

const BASE = "https://api.openalex.org/sources";

export interface OaSource {
  id?: string;
  name?: string;
  publisher?: string;
  homepage?: string;
  issnL?: string;
  issns?: string[];
  impact2yr?: number;
  hIndex?: number;
  worksCount?: number;
  citedByCount?: number;
  isOa?: boolean;
  isInDoaj?: boolean;
}

function ua(): string {
  const { email } = getPoliteIdentity();
  const mail = String(email || "").trim();
  // 非 ASCII 邮箱会让 Electron fetch 抛 ByteString；此处仅在纯 ASCII 时附带
  const safe = mail && /^[\x00-\x7F]+$/.test(mail) ? mail : "unknown";
  return `lumina-feed/1.0 (mailto:${safe})`;
}

function mapSource(w: any): OaSource {
  const stats = w?.summary_stats || {};
  return {
    id: typeof w?.id === "string" ? w.id.replace(/^https?:\/\/openalex\.org\//i, "") : undefined,
    name: w?.display_name || undefined,
    publisher: w?.host_organization_name || undefined,
    homepage: w?.homepage_url || undefined,
    issnL: w?.issn_l || undefined,
    issns: Array.isArray(w?.issn) ? w.issn : (w?.issn_l ? [w.issn_l] : []),
    impact2yr: typeof stats["2yr_mean_citedness"] === "number" ? stats["2yr_mean_citedness"] : undefined,
    hIndex: typeof stats.h_index === "number" ? stats.h_index : undefined,
    worksCount: typeof w?.works_count === "number" ? w.works_count : undefined,
    citedByCount: typeof w?.cited_by_count === "number" ? w.cited_by_count : undefined,
    isOa: typeof w?.is_oa === "boolean" ? w.is_oa : undefined,
    isInDoaj: typeof w?.is_in_doaj === "boolean" ? w.is_in_doaj : undefined,
  };
}

async function getJson(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<any> {
  const res = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": ua() },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ openalex.org`);
  return res.json();
}

/** 按 ISSN 精确查一本期刊 */
export async function fetchSourceByIssn(
  issn: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<OaSource | null> {
  const n = normalizeIssn(issn);
  if (!n) return null;
  const f = opts.fetchImpl ?? fetch;
  try {
    const j = await getJson(`${BASE}/issn:${n}`, f, opts.signal);
    if (!j || j.error) return null;
    return mapSource(j);
  } catch {
    return null;
  }
}

/** 按刊名检索，返回候选（第一条为最匹配） */
export async function searchSourcesByName(
  name: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; limit?: number } = {},
): Promise<OaSource[]> {
  const q = String(name || "").trim();
  if (!q) return [];
  const f = opts.fetchImpl ?? fetch;
  const { email } = getPoliteIdentity();
  const p = new URLSearchParams({ search: q, "per-page": String(opts.limit ?? 6) });
  const mail = String(email || "").trim();
  if (mail && /^[\x00-\x7F]+$/.test(mail)) p.set("mailto", mail);
  try {
    const j = await getJson(`${BASE}?${p}`, f, opts.signal);
    const results: any[] = Array.isArray(j?.results) ? j.results : [];
    return results.map(mapSource).filter((s) => s.name);
  } catch {
    return [];
  }
}
