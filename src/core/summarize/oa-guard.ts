// lumina-feed · URL 守门（OA 白名单 + 多源模式）
// allowAltSources:true 时放行 LibGen / Anna / Sci-Hub；false 时仅 isLegitimateOaUrl。

/** 影子图书馆 / 盗版聚合 —— 一律拒绝 */
export const OA_DENY_PATTERNS: RegExp[] = [
  /sci-?hub/i, /libgen/i, /library\.lol/i, /\bz-?lib(rary)?\b/i, /annas[-_]?archive/i,
  /b-ok\b/i, /1lib\b/i, /booksc\b/i, /sci-hub\.[a-z.]+/i, /gen\.lib/i,
];

/** 已知合法 OA / 仓储主机（白名单启发，配合「以 .pdf 结尾或声明 OA」判断） */
const OA_ALLOW_HOSTS: RegExp[] = [
  /(^|\.)ncbi\.nlm\.nih\.gov$/i, /(^|\.)pmc\.ncbi\.nlm\.nih\.gov$/i, /(^|\.)europepmc\.org$/i,
  /(^|\.)arxiv\.org$/i, /(^|\.)biorxiv\.org$/i, /(^|\.)medrxiv\.org$/i,
  /(^|\.)plos\.org$/i, /(^|\.)nature\.com$/i, /(^|\.)springeropen\.com$/i, /(^|\.)mdpi\.com$/i,
  /(^|\.)frontiersin\.org$/i, /(^|\.)biomedcentral\.com$/i, /(^|\.)elifesciences\.org$/i,
  /(^|\.)doaj\.org$/i, /(^|\.)osf\.io$/i, /(^|\.)ssrn\.com$/i, /(^|\.)researchsquare\.com$/i,
  /(^|\.)hindawi\.com$/i, /(^|\.)wiley\.com$/i, /(^|\.)oup\.com$/i,
];

export interface FetchUrlOptions {
  /** true（默认）：备选渠道与 OA 同一抓取链，不因影子库 deny 拦截 */
  allowAltSources?: boolean;
}

/** 全文抓取是否允许该 URL（统一链模式下放行备选渠道） */
export function isFetchableUrl(url?: string, opts: FetchUrlOptions = {}): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (opts.allowAltSources !== false) return true;
  return isLegitimateOaUrl(url);
}

/** 是否合法 OA 链接：先过 deny，再要求（白名单主机 或 .pdf 资源 或 OA 仓储路径） */
export function isLegitimateOaUrl(url?: string): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const full = `${u.host}${u.pathname}`;
  if (OA_DENY_PATTERNS.some((re) => re.test(url) || re.test(full))) return false; // 硬拒影子库
  const host = u.host.toLowerCase();
  if (OA_ALLOW_HOSTS.some((re) => re.test(host))) return true;
  // 非白名单：仅当看起来是直接 PDF 资源（保守放行）
  if (/\.pdf($|\?)/i.test(u.pathname)) return true;
  return false;
}
