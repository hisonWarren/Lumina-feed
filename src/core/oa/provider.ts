// lumina-feed · M3 全文提供者装配
import type { Paper } from "../model.ts";
import type { FullTextProvider } from "../summarize/types.ts";
import { makeFullTextProvider } from "../summarize/fulltext.ts";
import { resolvePdfCandidates, type ResolveDeps } from "./oa-resolver.ts";
import { fetchScihubPdf } from "./alt-sources.ts";
import { fetchPdf, type FetchPdfDeps } from "./pdf-fetch.ts";
import { extractText, type ExtractDeps } from "./pdf-extract.ts";

export interface OaFullTextDeps extends ResolveDeps, FetchPdfDeps, ExtractDeps {
  minChars?: number;
  perAttemptTimeoutMs?: number;
}

export interface FetchPaperResult {
  ok: true;
  bytes: Uint8Array;
  url: string;
  source: string;
}

export interface FetchPaperFailure {
  ok: false;
  reason: string;
}

/** 按统一候选链抓取 PDF 字节（OA → LibGen → Anna → Sci-Hub）。 */
export async function fetchPaperPdf(paper: Paper, deps: OaFullTextDeps = {}): Promise<FetchPaperResult | FetchPaperFailure> {
  const candidates = await resolvePdfCandidates(paper, { ...deps, includeAltSources: deps.includeAltSources !== false });
  for (const cand of candidates) {
    try {
      if (cand.kind === "scihub") {
        const got = await fetchScihubPdf(cand.doi, { fetchImpl: deps.fetchImpl, signal: deps.signal });
        if (got?.bytes?.byteLength) return { ok: true, bytes: got.bytes, url: got.url, source: cand.source };
        continue;
      }
      const bytes = await fetchPdf(cand.url, { ...deps, allowAltSources: true, signal: deps.signal });
      if (bytes.byteLength) return { ok: true, bytes, url: cand.url, source: cand.source };
    } catch { /* 试下一候选 */ }
  }
  return { ok: false, reason: "no_pdf" };
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
