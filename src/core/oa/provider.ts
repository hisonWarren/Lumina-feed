// lumina-feed · M3 全文提供者装配
import type { FullTextProvider } from "../summarize/types.ts";
import { makeFullTextProvider } from "../summarize/fulltext.ts";
import { resolvePdfCandidates, type ResolveDeps } from "./oa-resolver.ts";
import { fetchPdf, type FetchPdfDeps } from "./pdf-fetch.ts";
import { extractText, type ExtractDeps } from "./pdf-extract.ts";

export interface OaFullTextDeps extends ResolveDeps, FetchPdfDeps, ExtractDeps {
  minChars?: number;
  perAttemptTimeoutMs?: number;
}

/** 组装全文提供者（统一候选链 + 超时重试），注入 M4 summarizePaper(deps.fullText)。 */
export function makeOaFullTextProvider(deps: OaFullTextDeps = {}): FullTextProvider {
  const allowAlt = deps.allowAltSources !== false;
  return makeFullTextProvider({
    resolveCandidates: (paper) => resolvePdfCandidates(paper, deps),
    fetchPdf: (url, signal) => fetchPdf(url, { ...deps, signal, allowAltSources: allowAlt }),
    extractText: (bytes) => extractText(bytes, deps),
    minChars: deps.minChars ?? 400,
    perAttemptTimeoutMs: deps.perAttemptTimeoutMs ?? 30_000,
    allowAltSources: allowAlt,
  });
}

export { resolvePdfCandidates, resolveOa, type ResolveDeps } from "./oa-resolver.ts";
export { fetchPdf, extractText };
