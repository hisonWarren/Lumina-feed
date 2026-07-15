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
import { fetchScihubPdf, scihubCandidate, type AltMirrorSettings } from "./alt-sources.ts";
import { orderMirrors } from "./mirror-health.ts";
import { fetchPdf, type FetchPdfDeps } from "./pdf-fetch.ts";
import { extractText, type ExtractDeps } from "./pdf-extract.ts";
import { makeTraceEmitter, traceStepForSource, type FetchTraceCallback } from "./fetch-trace.ts";
import { attemptSignal } from "./timeout.ts";
import { candidateKey, type PdfCandidate } from "./candidate.ts";
import { verifyPdfIdentity, shouldVerifyPdfIdentity, urlImpliesDoi } from "./pdf-identity.ts";
import { normDoi } from "../dedupe.ts";
import { biorxivApiPdfCandidates, biorxivPdfCandidates, fetchBiorxivLatestVersion, isBiorxivDoi } from "./biorxiv-resolve.ts";
import { chemrxivPdfCandidates, isChemrxivDoi } from "./chemrxiv-resolve.ts";
import { figsharePdfCandidates, isFigshareDoi } from "./figshare-resolve.ts";

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
  const doi = String(paper.doi || "").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  if (isBiorxivDoi(doi)) return true;
  if (/^10\.26434\/chemrxiv/i.test(doi)) return true;
  if (/^10\.6084\/m9\.figshare/i.test(doi)) return true;
  if (paper.oaUrl || paper.pmcid || paper.arxivId) return true;
  if (/arxiv\.\d+\.\d+/i.test(doi)) return true;
  return false;
}

async function tryOneCandidate(
  cand: PdfCandidate,
  paper: Paper,
  deps: OaFullTextDeps,
  trace: ReturnType<typeof makeTraceEmitter> | null,
  attemptMs: number,
  scihubMirrorsRef: { current?: string[] },
): Promise<{ hit: FetchPaperResult | null; identityRejected?: boolean }> {
  const stepId = cand.kind === "scihub" ? "scihub" : traceStepForSource(cand.source);
  trace?.patch("download", "running", cand.source);
  const t0 = Date.now();
  const attempt = attemptSignal(deps.signal, attemptMs);
  try {
    if (cand.kind === "scihub") {
      // 独立超时：勿在 OA/探活已耗时后被父 signal 立刻掐断
      attempt.clear();
      const sciAttempt = attemptSignal(deps.signal, Math.max(attemptMs, 40_000));
      try {
        if (!scihubMirrorsRef.current) {
          const { ordered } = await orderMirrors("scihub", deps.mirrorSettings, {
            fetchImpl: deps.fetchImpl,
            signal: sciAttempt.signal,
          });
          scihubMirrorsRef.current = ordered;
        }
        const got = await fetchScihubPdf(cand.doi, {
          fetchImpl: deps.fetchImpl,
          signal: sciAttempt.signal,
          mirrors: scihubMirrorsRef.current,
        });
        if (got?.bytes?.byteLength) {
          // URL 已编码目标 DOI 时可跳过正文抽 DOI；否则走已修复粘连误杀的校验
          const urlTrusted = !!(paper.doi && urlImpliesDoi(got.url, paper.doi));
          if (!urlTrusted && shouldVerifyPdfIdentity(cand, paper)) {
            const id = verifyPdfIdentity(got.bytes, { doi: paper.doi, title: paper.title });
            if (!id.ok) {
              const detail = id.reason === "doi_mismatch" ? "PDF DOI 不符" : "PDF 标题不符";
              trace?.patch(stepId, "fail", detail, Date.now() - t0);
              return { hit: null, identityRejected: true };
            }
          }
          trace?.patch(stepId, "ok", "PDF 已获取", Date.now() - t0);
          trace?.patch("download", "ok", cand.source, Date.now() - t0);
          trace?.skipRest(stepId);
          return { hit: { ok: true, bytes: got.bytes, url: got.url, source: cand.source } };
        }
        trace?.patch(stepId, "fail", sciAttempt.timedOut() ? "超时" : "镜像无 PDF", Date.now() - t0);
        return { hit: null };
      } finally {
        sciAttempt.clear();
      }
    }
    const bytes = await fetchPdf(cand.url, { ...deps, allowAltSources: true, signal: attempt.signal });
    if (bytes.byteLength) {
      if (shouldVerifyPdfIdentity(cand, paper)) {
        const id = verifyPdfIdentity(bytes, { doi: paper.doi, title: paper.title });
        if (!id.ok) {
          const detail = id.reason === "doi_mismatch" ? "PDF DOI 不符" : "PDF 标题不符";
          trace?.patch(stepId, "fail", detail, Date.now() - t0);
          return { hit: null, identityRejected: true };
        }
      }
      trace?.patch(stepId, "ok", "PDF 已获取", Date.now() - t0);
      trace?.patch("download", "ok", cand.source, Date.now() - t0);
      trace?.skipRest(stepId);
      return { hit: { ok: true, bytes, url: cand.url, source: cand.source } };
    }
    trace?.patch(stepId, "fail", attempt.timedOut() ? "超时" : "空响应", Date.now() - t0);
    return { hit: null };
  } catch (e) {
    const msg = attempt.timedOut() ? "超时" : String((e as Error)?.message || e);
    trace?.patch(stepId, "fail", msg, Date.now() - t0);
    return { hit: null };
  } finally {
    attempt.clear();
  }
}

async function tryCandidateList(
  candidates: PdfCandidate[],
  paper: Paper,
  deps: OaFullTextDeps,
  trace: ReturnType<typeof makeTraceEmitter> | null,
  attemptMs: number,
  tried: Set<string>,
): Promise<{ hit: FetchPaperResult | null; publisherBlocked: boolean; identityRejected: boolean }> {
  const scihubMirrorsRef: { current?: string[] } = {};
  let publisherBlocked = false;
  let identityRejected = false;
  for (const cand of candidates) {
    const key = candidateKey(cand);
    if (!key || tried.has(key)) continue;
    tried.add(key);
    const { hit, identityRejected: idRej } = await tryOneCandidate(cand, paper, deps, trace, attemptMs, scihubMirrorsRef);
    if (idRej) identityRejected = true;
    if (hit) return { hit, publisherBlocked, identityRejected };
    if (cand.kind === "url" && /sagepub|wiley|tandfonline|springer|elsevier|oup\.com/i.test(cand.url)) {
      publisherBlocked = true;
    }
  }
  return { hit: null, publisherBlocked, identityRejected };
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
  let publisherBlocked = false;
  let identityRejected = false;

  trace?.patch("identifiers", "running");
  const immediate = immediatePdfCandidates(paper);
  trace?.patch("identifiers", immediate.length ? "ok" : "skip", immediate.length ? `${immediate.length} 个` : undefined);

  const doiNorm = String(paper.doi || "").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  let biorxivLatest: { version: number; server: "biorxiv" | "medrxiv" } | null = null;
  if (isBiorxivDoi(doiNorm)) {
    const apiAttempt = attemptSignal(deps.signal, deps.oaAttemptTimeoutMs ?? 10_000);
    try {
      biorxivLatest = await fetchBiorxivLatestVersion(doiNorm, deps.fetchImpl, apiAttempt.signal);
    } catch { /* API 超时/失败走版本回退 */ }
    finally { apiAttempt.clear(); }
  }
  const earlyApis: { step: string; run: () => Promise<import("./candidate.ts").UrlCandidate[]> }[] = [];
  if (isBiorxivDoi(doiNorm)) {
    earlyApis.push({
      step: "biorxiv_api",
      run: () => biorxivApiPdfCandidates(doiNorm, deps.fetchImpl, deps.signal, biorxivLatest),
    });
  }
  if (isChemrxivDoi(doiNorm)) earlyApis.push({ step: "chemrxiv_api", run: () => chemrxivPdfCandidates(doiNorm, deps.fetchImpl, deps.signal) });
  if (isFigshareDoi(doiNorm)) earlyApis.push({ step: "figshare_api", run: () => figsharePdfCandidates(doiNorm, deps.fetchImpl, deps.signal) });
  for (const { step, run } of earlyApis) {
    trace?.patch(step, "running");
    const apiCands = await run();
    trace?.patch(step, apiCands.length ? "ok" : "fail", apiCands.length ? apiCands[0]?.source : undefined);
    if (!apiCands.length) continue;
    const { hit, publisherBlocked: pb, identityRejected: idRej } = await tryCandidateList(apiCands, paper, deps, trace, dlMs, tried);
    if (pb) publisherBlocked = true;
    if (idRej) identityRejected = true;
    if (hit) {
      trace?.done("done", { ok: true, source: hit.source });
      return hit;
    }
  }

  // bioRxiv API 直链失败后：从已知最新版本向下扫（避免 v10→v1 全量阻塞）
  if (isBiorxivDoi(doiNorm)) {
    const maxV = biorxivLatest?.version ?? 10;
    const syncCands = biorxivPdfCandidates(doiNorm, maxV)
      .filter((c) => !tried.has(candidateKey(c)))
      .slice(0, 8);
    if (syncCands.length) {
      trace?.patch("biorxiv_api", "running", `版本回退≤v${maxV}`);
      const { hit, publisherBlocked: pb, identityRejected: idRej } = await tryCandidateList(syncCands, paper, deps, trace, dlMs, tried);
      if (pb) publisherBlocked = true;
      if (idRej) identityRejected = true;
      if (hit) {
        trace?.patch("biorxiv_api", "ok", hit.source);
        trace?.done("done", { ok: true, source: hit.source });
        return hit;
      }
      trace?.patch("biorxiv_api", "fail", "版本回退未命中");
    }
  }

  if (immediate.length) {
    const { hit, publisherBlocked: pb, identityRejected: idRej } = await tryCandidateList(immediate, paper, deps, trace, dlMs, tried);
    if (pb) publisherBlocked = true;
    if (idRej) identityRejected = true;
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
    const { hit, publisherBlocked: pb, identityRejected: idRej } = await tryCandidateList(oaNew, paper, deps, trace, dlMs, tried);
    if (pb) publisherBlocked = true;
    if (idRej) identityRejected = true;
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

  // OA 耗尽后立刻试 Sci-Hub（勿等 LibGen/Anna 探活结束才排队）
  const scihubMirrorsRef: { current?: string[] } = {};
  const doiForAlt = normDoi(paper.doi);
  if (doiForAlt) {
    const sciCand = scihubCandidate(doiForAlt);
    const sciKey = candidateKey(sciCand);
    if (sciKey && !tried.has(sciKey)) {
      tried.add(sciKey);
      const { hit: sciHit, identityRejected: sciIdRej } = await tryOneCandidate(
        sciCand, paper, deps, trace, Math.max(altMs, 40_000), scihubMirrorsRef,
      );
      if (sciIdRej) identityRejected = true;
      if (sciHit) {
        trace?.done("done", { ok: true, source: sciHit.source });
        return sciHit;
      }
    }
  }

  if (deferAlt) {
    trace?.patch("libgen", "skip", "OA 阶段未命中，进入备用库");
    trace?.patch("annas", "skip");
  }

  const altCands = (deferAlt
    ? await resolveAltPdfCandidates(paper, { ...deps, onTrace })
    : (await resolvePdfCandidates(paper, { ...deps, includeAltSources: true, onTrace }))
  ).filter((c) => c.kind !== "scihub" && !tried.has(candidateKey(c)));

  if (altCands.length) {
    const { hit, publisherBlocked: pb, identityRejected: idRej } = await tryCandidateList(altCands, paper, deps, trace, altMs, tried);
    if (pb) publisherBlocked = true;
    if (idRej) identityRejected = true;
    if (hit) {
      trace?.done("done", { ok: true, source: hit.source });
      return hit;
    }
  }

  const reason = identityRejected
    ? "identity_mismatch"
    : publisherBlocked && tried.size > 0
      ? "publisher_blocked"
      : "no_pdf";
  trace?.patch("download", "fail", reason === "identity_mismatch" ? "下载内容与目标文献不符" : reason === "publisher_blocked" ? "出版商拦截自动下载" : "全部候选失败");
  trace?.done("done", { ok: false, reason });
  return { ok: false, reason };
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
