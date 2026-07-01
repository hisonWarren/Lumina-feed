// lumina-feed · OA 抓取 URL 归一化（落地页 HTML / DOI 链接 → 可下载 PDF 直链）
import { isNonAutomatableLandingUrl } from "./landing-hosts.ts";
/** OSF 预印本 id（如 jfrwu_v1）→ 项目直链下载 */
export function osfPreprintDownloadUrl(preprintId?: string): string | undefined {
  if (!preprintId) return undefined;
  const guid = String(preprintId).replace(/_v\d+$/i, "");
  return /^[a-z0-9]+$/i.test(guid) ? `https://osf.io/${guid}/download` : undefined;
}

/** PsyArXiv / OSF 预印本 DOI（10.31234/osf.io/…） */
export function osfDoiDownloadUrl(doi?: string): string | undefined {
  const d = String(doi || "").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  const m = /^10\.31234\/osf\.io\/([a-z0-9]+)(?:_v\d+)?$/i.exec(d);
  return m ? `https://osf.io/${m[1]}/download` : undefined;
}

function normalizeOsfUrl(url: string): string | undefined {
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

function normalizeBiorxivUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!/(^|\.)biorxiv\.org$|(^|\.)medrxiv\.org$/i.test(u.host)) return url;
    if (!/\/content\/10\.1101\//i.test(u.pathname)) return url;
    if (/\.full\.pdf($|\?)/i.test(u.pathname)) return url;
    const base = url.split("#")[0].split("?")[0];
    return base.endsWith("/") ? `${base.slice(0, -1)}.full.pdf` : `${base}.full.pdf`;
  } catch {
    return url;
  }
}

function normalizeArxivUrl(url: string): string | undefined {
  if (!/arxiv\.org\/abs\//i.test(url)) return url;
  return url.replace(/\/abs\//i, "/pdf/").replace(/\/pdf\/(\d+\.\d+)$/i, "/pdf/$1.pdf");
}

/** 纯 DOI 落地页不是 PDF；归一化后返回 undefined 表示不可直抓 */
function stripDoiLanding(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (/(^|\.)doi\.org$|(^|\.)dx\.doi\.org$/i.test(u.host)) return undefined;
    return url;
  } catch {
    return url;
  }
}

/**
 * 将检索/合并阶段存入的 oaUrl 转为尽可能可抓取的 PDF 直链。
 * 返回 undefined 表示该 URL 不应作为 PDF 候选（如纯 DOI 页、OSF 无法解析的预印本页）。
 */
export function normalizeOaFetchUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (isNonAutomatableLandingUrl(url)) return undefined;
  let u = stripDoiLanding(url);
  if (!u) return undefined;
  u = normalizeArxivUrl(u) || u;
  u = normalizeBiorxivUrl(u) || u;
  u = normalizeOsfUrl(u) || u;
  return u || undefined;
}

/** @deprecated 使用 normalizeOaFetchUrl */
export const normalizeOsfFetchUrl = normalizeOaFetchUrl;

export function biorxivPdfUrl(doi: string, version: number | string, server: "biorxiv" | "medrxiv" = "biorxiv"): string {
  const v = version ?? 1;
  return `https://www.${server}.org/content/${doi}v${v}.full.pdf`;
}

/** Europe PMC fullTextUrl 列表：优先 PDF，跳过纯 DOI 链接 */
export function pickEuropePmcOaUrl(urls: { availabilityCode?: string; documentStyle?: string; url?: string }[]): string | undefined {
  const list = Array.isArray(urls) ? urls : [];
  const isOa = (u: { availabilityCode?: string }) => u.availabilityCode === "OA" || u.availabilityCode === "F";
  const pdf = list.find((u) => isOa(u) && u.documentStyle === "pdf" && u.url);
  if (pdf?.url) return normalizeOaFetchUrl(pdf.url) || pdf.url;
  const html = list.find((u) => isOa(u) && u.documentStyle === "html" && u.url);
  if (html?.url) return normalizeOaFetchUrl(html.url) || html.url;
  const any = list.find((u) => isOa(u) && u.url);
  return any?.url ? normalizeOaFetchUrl(any.url) : undefined;
}
