// lumina-feed · 主进程 PDF HTTP（Chromium session + bioRxiv 落地页预热绕 Cloudflare）
import { getRefererForUrl } from "../src/core/oa/referer.ts";
import { ASCII_UA, sessionFetchSafe } from "./safe-fetch.ts";
import { toByteStringHeader } from "../src/core/net/byte-string.ts";

function headersFor(url: string, accept = "application/pdf,*/*"): Record<string, string> {
  const h: Record<string, string> = {
    Accept: accept,
    "User-Agent": ASCII_UA,
  };
  const ref = getRefererForUrl(url);
  const safeRef = ref ? toByteStringHeader(ref) : undefined;
  if (safeRef) h.Referer = safeRef;
  return h;
}

export async function mainSessionFetch(url: string, signal?: AbortSignal, accept?: string): Promise<Response> {
  return sessionFetchSafe(url, { headers: headersFor(url, accept), signal });
}

function biorxivLandingForPdf(pdfUrl: string): string | undefined {
  const m = /\/content\/(10\.1101\/[^/]+)v(\d+)\.full\.pdf/i.exec(pdfUrl);
  if (!m) return undefined;
  try {
    const u = new URL(pdfUrl);
    return `${u.origin}/content/${m[1]}v${m[2]}`;
  } catch {
    return undefined;
  }
}

/** 先访问 HTML 落地页再抓 .full.pdf（bioRxiv / medRxiv Cloudflare）。 */
export async function fetchPdfViaSession(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const landing = biorxivLandingForPdf(url);
  if (landing) {
    try {
      await mainSessionFetch(landing, signal, "text/html,application/xhtml+xml,*/*");
    } catch { /* 预热失败仍尝试 PDF */ }
  }
  const res = await mainSessionFetch(url, signal);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
