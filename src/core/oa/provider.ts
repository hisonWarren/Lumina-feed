// lumina-feed · M3 全文提供者装配
import type { Paper } from "../model.ts";
import type { FullTextProvider } from "../summarize/types.ts";
import { makeFullTextProvider } from "../summarize/fulltext.ts";
import { resolvePdfCandidates, type ResolveDeps } from "./oa-resolver.ts";
import { fetchScihubPdf, type AltMirrorSettings } from "./alt-sources.ts";
import { orderMirrors } from "./mirror-health.ts";
import { fetchPdf, type FetchPdfDeps } from "./pdf-fetch.ts";
import { extractText, type ExtractDeps } from "./pdf-extract.ts";
import { makeTraceEmitter, traceStepForSource, type FetchTraceCallback } from "./fetch-trace.ts";
import { attemptSignal } from "./timeout.ts";

export interface OaFullTextDeps extends ResolveDeps, FetchPdfDeps, ExtractDeps {
  minChars?: number;
  perAttemptTimeoutMs?: number;
  mirrorSettings?: AltMirrorSettings;
  onTrace?: FetchTraceCallback;
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
  const trace = deps.onTrace ? makeTraceEmitter(deps.onTrace) : null;
  const onTrace = trace
    ? (stepId: string, status: "pending" | "running" | "ok" | "fail" | "skip", detail?: string, ms?: number) =>
      trace.patch(stepId, status, detail, ms)
    : undefined;

  const candidates = await resolvePdfCandidates(paper, {
    ...deps,
    includeAltSources: deps.includeAltSources !== false,
    mirrorSettings: deps.mirrorSettings,
    onTrace,
  });

  if (!candidates.length) {
    trace?.done("done", { ok: false, reason: "no_pdf" });
    return { ok: false, reason: "no_pdf" };
  }

  let scihubMirrors: string[] | undefined;
  const attemptMs = deps.perAttemptTimeoutMs ?? 25_000;
  for (const cand of candidates) {
    const stepId = cand.kind === "scihub" ? "scihub" : traceStepForSource(cand.source);
    trace?.patch("download", "running", cand.source);
    const t0 = Date.now();
    const attempt = attemptSignal(deps.signal, attemptMs);
    try {
      if (cand.kind === "scihub") {
        attempt.clear();
        if (!scihubMirrors) {
          const { ordered } = await orderMirrors("scihub", deps.mirrorSettings, {
            fetchImpl: deps.fetchImpl,
            signal: deps.signal,
          });
          scihubMirrors = ordered;
        }
        const got = await fetchScihubPdf(cand.doi, {
          fetchImpl: deps.fetchImpl,
          signal: deps.signal,
          mirrors: scihubMirrors,
        });
        if (got?.bytes?.byteLength) {
          trace?.patch(stepId, "ok", "PDF 已获取", Date.now() - t0);
          trace?.patch("download", "ok", cand.source, Date.now() - t0);
          trace.done("done", { ok: true, source: cand.source });
          return { ok: true, bytes: got.bytes, url: got.url, source: cand.source };
        }
        trace?.patch(stepId, "fail", "镜像无 PDF", Date.now() - t0);
        continue;
      }
      const bytes = await fetchPdf(cand.url, { ...deps, allowAltSources: true, signal: attempt.signal });
      if (bytes.byteLength) {
        trace?.patch(stepId, "ok", "PDF 已获取", Date.now() - t0);
        trace?.patch("download", "ok", cand.source, Date.now() - t0);
        trace.done("done", { ok: true, source: cand.source });
        return { ok: true, bytes, url: cand.url, source: cand.source };
      }
      trace?.patch(stepId, "fail", attempt.timedOut() ? "超时" : "空响应", Date.now() - t0);
    } catch (e) {
      const msg = attempt.timedOut() ? "超时" : String((e as Error)?.message || e);
      trace?.patch(stepId, "fail", msg, Date.now() - t0);
    } finally {
      attempt.clear();
    }
  }
  trace?.patch("download", "fail", "全部候选失败");
  trace?.done("done", { ok: false, reason: "no_pdf" });
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
