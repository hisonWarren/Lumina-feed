// lumina-feed · M3 合法 OA 全文 · 汇总导出
export { resolveOa, resolvePdfCandidates, type ResolveDeps } from "./oa-resolver.ts";
export { type PdfCandidate, type UrlCandidate, type ScihubCandidate } from "./candidate.ts";
export { fetchScihubPdf, resolveAltUrlCandidates } from "./alt-sources.ts";
export { attemptSignal, isTimeoutError } from "./timeout.ts";
export { fetchPdf, type FetchPdfDeps } from "./pdf-fetch.ts";
export { extractText, extractPdfTextBasic, extractWithPdfjs, type PdfjsLoad, type ExtractDeps } from "./pdf-extract.ts";
export { makeOaFullTextProvider, type OaFullTextDeps } from "./provider.ts";
export { registerOaPdfBridge } from "./electron-bridge.ts";
// 红线守门复用 M4 的 oa-guard（单一来源）
export { isLegitimateOaUrl, isFetchableUrl, OA_DENY_PATTERNS } from "../summarize/oa-guard.ts";
