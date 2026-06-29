// lumina-feed · M3 全文提供者装配
import type { Paper } from "../model.ts";
import type { FullTextProvider } from "../summarize/types.ts";
import { makeFullTextProvider } from "../summarize/fulltext.ts";
import {
  resolvePdfCandidates,
  immediatePdfCandidates,
  resolveAltPdfCandidates,
  type ResolveDeps,
} from "./oa-resolver.ts";
import { fetchScihubPdf, type AltMirrorSettings } from "./alt-sources.ts";
import { orderMirrors } from "./mirror-health.ts";
import { fetchPdf, type FetchPdfDeps } from "./pdf-fetch.ts";
import { extractText, type ExtractDeps } from "./pdf-extract.ts";
import { makeTraceEmitter, traceStepForSource, type FetchTraceCallback } from "./fetch-trace.ts";
import { attemptSignal } from "./timeout.ts";
import { candidateKey, type PdfCandidate } from "./candidate.ts";

export interface OaFullTextDeps extends ResolveDeps, FetchPdfDeps, ExtractDeps {
  minChars?: number;
  perAttemptTimeoutMs?: number;
  oaAttemptTimeoutMs?: number;
  /** gold/green 等 OA 标注文献：先耗尽 OA 直链再进备用库 */
  deferAltSources?: boolean;
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

export function isOaMarkedPaper(paper: Paper): boolean {
  const s = String(paper.oaStatus || "").toLowerCase();
  if (["gold", "green", "hybrid", "bronze"].includes(s)) return true;
  if (paper.oaUrl || paper.pmcid || paper.arxivId) return true;
  if (/arxiv\.\d+\.\d+/i.test(String(paper.doi || ""))) return true;
  return false;
}

async function tryOneCandidate(
  cand: PdfCandidate,
  deps: OaFullTextDeps,
  trace: ReturnType<typeof makeTraceEmitter> | null,
  attemptMs: number,
  scihubMirrorsRef: { current?: string[] },
): Promise<FetchPaperResult | null> {
  const stepId = cand.kind === "scihub" ? "scihub" : traceStepForSource(cand.source);
  trace?.patch("download", "running", cand.source);
  const t0 = Date.now();
  const attempt = attemptSignal(deps.signal, attemptMs);
  try {
    if (cand.kind === "scihub") {
      attempt.clear();
      if (!scihubMirrorsRef.current) {
        const { ordered } = await orderMirrors("scihub", deps.mirrorSettings, {
          fetchImpl: deps.fetchImpl,
          signal: deps.signal,
        });
        scihubMirrorsRef.current = ordered;
      }
      const got = await fetchScihubPdf(cand.doi, {
        fetchImpl: deps.fetchImpl,
        signal: deps.signal,
        mirrors: scihubMirrorsRef.current,
      });
      if (got?.bytes?.byteLength) {
        trace?.patch(stepId, "ok", "PDF 已获取", Date.now() - t0);
        trace?.patch("download", "ok", cand.source, Date.now() - t0);
        trace?.skipRest(stepId);
        return { ok: true, bytes: got.bytes, url: got.url, source: cand.source };
      }
      trace?.patch(stepId, "fail", "镜像无 PDF", Date.now() - t0);
      return null;
    }
    const bytes = await fetchPdf(cand.url, { ...deps, allowAltSources: true, signal: attempt.signal });
    if (bytes.byteLength) {
      trace?.patch(stepId, "ok", "PDF 已获取", Date.now() - t0);
      trace?.patch("download", "ok", cand.source, Date.now() - t0);
      trace?.skipRest(stepId);
      return { ok: true, bytes, url: cand.url, source: cand.source };
    }
    trace?.patch(stepId, "fail", attempt.timedOut() ? "超时" : "空响应", Date.now() - t0);
    return null;
  } catch (e) {
    const msg = attempt.timedOut() ? "超时" : String((e as Error)?.message || e);
    trace?.patch(stepId, "fail", msg, Date.now() - t0);
    return null;
  } finally {
    attempt.clear();
  }
}

async function tryCandidateList(
  candidates: PdfCandidate[],
  deps: OaFullTextDeps,
  trace: ReturnType<typeof makeTraceEmitter> | null,
  attemptMs: number,
  tried: Set<string>,
): Promise<FetchPaperResult | null> {
  const scihubMirrorsRef: { current?: string[] } = {};
  for (const cand of candidates) {
    const key = candidateKey(cand);
    if (!key || tried.has(key)) continue;
    tried.add(key);
    const hit = await tryOneCandidate(cand, deps, trace, attemptMs, scihubMirrorsRef);
    if (hit) return hit;
  }
  return null;
}

/** 按统一候选链抓取 PDF 字节（OA 快路径 → 元数据 enrich → 备用库）。 */
export async function fetchPaperPdf(paper: Paper, deps: OaFullTextDeps = {}): Promise<FetchPaperResult | FetchPaperFailure> {
  const trace = deps.onTrace ? makeTraceEmitter(deps.onTrace) : null;
  const onTrace = trace
    ? (stepId: string, status: "pending" | "running" | "ok" | "fail" | "skip", detail?: string, ms?: number) =>
      trace.patch(stepId, status, detail, ms)
    : undefined;

  const dlMs = deps.perAttemptTimeoutMs ?? 22_000;
  const altMs = deps.perAttemptTimeoutMs ?? 22_000;
  const deferAlt = deps.deferAltSources !== false && isOaMarkedPaper(paper);
  const tried = new Set<string>();

  trace?.patch("identifiers", "running");
  const immediate = immediatePdfCandidates(paper);
  trace?.patch("identifiers", immediate.length ? "ok" : "skip", immediate.length ? `${immediate.length} 个` : undefined);

  if (immediate.length) {
    const hit = await tryCandidateList(immediate, deps, trace, dlMs, tried);
    if (hit) {
      trace?.done("done", { ok: true, source: hit.source });
      return hit;
    }
  }

  const oaEnriched = await resolvePdfCandidates(paper, {
    ...deps,
    includeAltSources: false,
    mirrorSettings: deps.mirrorSettings,
    onTrace,
  });
  const oaNew = oaEnriched.filter((c) => !tried.has(candidateKey(c)));
  if (oaNew.length) {
    const hit = await tryCandidateList(oaNew, deps, trace, dlMs, tried);
    if (hit) {
      trace?.done("done", { ok: true, source: hit.source });
      return hit;
    }
  }

  if (deps.includeAltSources === false) {
    trace?.patch("download", "fail", "无 OA 直链");
    trace?.done("done", { ok: false, reason: "no_pdf" });
    return { ok: false, reason: "no_pdf" };
  }

  if (deferAlt) {
    trace?.patch("libgen", "skip", "OA 阶段未命中，进入备用库");
    trace?.patch("annas", "skip");
  }

  const altCands = deferAlt
    ? await resolveAltPdfCandidates(paper, { ...deps, onTrace })
    : (await resolvePdfCandidates(paper, { ...deps, includeAltSources: true, onTrace }))
      .filter((c) => !tried.has(candidateKey(c)));

  if (altCands.length) {
    const hit = await tryCandidateList(altCands, deps, trace, altMs, tried);
    if (hit) {
      trace?.done("done", { ok: true, source: hit.source });
      return hit;
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

export { resolvePdfCandidates, resolveOa, immediatePdfCandidates, resolveAltPdfCandidates, type ResolveDeps } from "./oa-resolver.ts";
export { fetchPdf, extractText };
