// lumina-feed · M3 PDF 抓取
// 桌面端经 Electron 主进程桥（绕 CORS、可控网络）；web 端用 global fetch 诚实降级。
// 统一候选链：allowAltSources 时与 OA 同一顺序，不因影子库 deny 拦截。
import { isFetchableUrl } from "../summarize/oa-guard.ts";
import { getRefererForUrl } from "./referer.ts";

export interface FetchPdfDeps {
  fetchImpl?: typeof fetch;
  /** 桌面端注入：经 Electron 主进程取字节（main 侧应再次守门） */
  electronFetch?: (url: string, signal?: AbortSignal) => Promise<Uint8Array>;
  signal?: AbortSignal;
  maxBytes?: number;
  requirePdfContentType?: boolean;
  /** false 时仅抓取 isLegitimateOaUrl（默认 true） */
  allowAltSources?: boolean;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

function looksLikePdf(bytes: Uint8Array): boolean {
  for (let i = 0; i < PDF_MAGIC.length; i++) if (bytes[i] !== PDF_MAGIC[i]) return false;
  return true;
}

function buildHeaders(url: string): Record<string, string> {
  const h: Record<string, string> = { accept: "application/pdf,*/*" };
  const referer = getRefererForUrl(url);
  if (referer) h.referer = referer;
  return h;
}

/** 抓取 PDF 字节。非法链接/非 PDF/超限 → 抛错（上层试下一个候选或回退摘要）。 */
export async function fetchPdf(url: string, deps: FetchPdfDeps = {}): Promise<Uint8Array> {
  const allowAlt = deps.allowAltSources !== false;
  if (!isFetchableUrl(url, { allowAltSources: allowAlt })) {
    throw new Error(allowAlt ? "无效链接" : "链接不可抓取");
  }

  const max = deps.maxBytes ?? 30 * 1024 * 1024;

  if (deps.electronFetch) {
    const bytes = await deps.electronFetch(url, deps.signal);
    if (bytes.byteLength > max) throw new Error(`PDF 超过大小上限(${max} bytes)`);
    if (!looksLikePdf(bytes)) throw new Error("内容非 PDF（magic 不匹配）");
    return bytes;
  }

  const f = deps.fetchImpl ?? fetch;
  const res = await f(url, {
    signal: deps.signal,
    redirect: "follow",
    headers: buildHeaders(url),
  } as RequestInit);
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);
  const ct = (res.headers?.get?.("content-type") ?? "").toLowerCase();
  const requireCt = deps.requirePdfContentType ?? true;
  if (requireCt && ct && !ct.includes("pdf") && !ct.includes("octet-stream") && !ct.includes("html")) {
    // 部分仓储先返回 HTML 再重定向；仅当明确非 PDF 且非 HTML 时拒绝
    if (!ct.includes("html")) throw new Error(`content-type 非 PDF: ${ct}`);
  }
  const len = Number(res.headers?.get?.("content-length") ?? 0);
  if (len && len > max) throw new Error(`PDF 超过大小上限(${max} bytes)`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > max) throw new Error(`PDF 超过大小上限(${max} bytes)`);
  if (!looksLikePdf(buf)) throw new Error("内容非 PDF（magic 不匹配）");
  return buf;
}
