// lumina-feed · 全文提供者（统一候选链 + 超时跳过 + 末尾集中重试）
import type { Paper } from "../model.ts";
import type { FullTextProvider, FullTextResult } from "./types.ts";
import { isFetchableUrl } from "./oa-guard.ts";
import type { PdfCandidate } from "../oa/candidate.ts";
import { fetchScihubPdf } from "../oa/alt-sources.ts";
import { attemptSignal, isTimeoutError } from "../oa/timeout.ts";

export interface FullTextDeps {
  /** 解析候选（统一链：OA + 备选 + Sci-Hub） */
  resolveCandidates?: (paper: Paper) => Promise<PdfCandidate[]> | PdfCandidate[];
  /** 兼容旧接口 */
  resolveOa?: (paper: Paper) => Promise<string[]> | string[];
  fetchPdf?: (url: string, signal?: AbortSignal) => Promise<Uint8Array>;
  extractText?: (pdf: Uint8Array) => Promise<string>;
  minChars?: number;
  /** 单次 URL/Sci-Hub 尝试超时（毫秒），超时先入队末尾重试 */
  perAttemptTimeoutMs?: number;
  allowAltSources?: boolean;
}

async function resolveAllCandidates(paper: Paper, deps: FullTextDeps): Promise<PdfCandidate[]> {
  if (deps.resolveCandidates) return [...(await deps.resolveCandidates(paper))];
  if (deps.resolveOa) {
    const urls = [...(await deps.resolveOa(paper)), ...(paper.oaUrl ? [paper.oaUrl] : [])];
    return urls.map((url, i) => ({ kind: "url" as const, url, source: "legacy", priority: i }));
  }
  return [];
}

/** 组装全文提供者；超时先跳过，全部首轮试完后集中重试，仍失败才 null。 */
export function makeFullTextProvider(deps: FullTextDeps): FullTextProvider {
  const min = deps.minChars ?? 400;
  const timeoutMs = deps.perAttemptTimeoutMs ?? 30_000;
  const allowAlt = deps.allowAltSources !== false;

  return {
    async getFullText(paper: Paper, opts = {}): Promise<FullTextResult | null> {
      if (!deps.fetchPdf || !deps.extractText) return null;
      if (!deps.resolveCandidates && !deps.resolveOa) return null;

      const candidates = await resolveAllCandidates(paper, deps);
      const deferred: PdfCandidate[] = [];

      const tryOne = async (cand: PdfCandidate, pass: "first" | "retry"): Promise<FullTextResult | null> => {
        const { signal, clear, timedOut } = attemptSignal(opts.signal, timeoutMs);
        try {
          if (cand.kind === "scihub") {
            const got = await fetchScihubPdf(cand.doi, { signal });
            if (!got) return null;
            const text = await deps.extractText!(got.bytes);
            if (text && text.replace(/\s+/g, "").length >= min) return { text, url: got.url };
            return null;
          }

          if (!isFetchableUrl(cand.url, { allowAltSources: allowAlt })) return null;
          const bytes = await deps.fetchPdf!(cand.url, signal);
          const text = await deps.extractText!(bytes);
          if (text && text.replace(/\s+/g, "").length >= min) return { text, url: cand.url };
          return null;
        } catch (err) {
          if (pass === "first" && timedOut() && isTimeoutError(err)) {
            deferred.push(cand);
          }
          return null;
        } finally {
          clear();
        }
      };

      for (const cand of candidates) {
        const hit = await tryOne(cand, "first");
        if (hit) return hit;
      }

      for (const cand of deferred) {
        const hit = await tryOne(cand, "retry");
        if (hit) return hit;
      }

      return null;
    },
  };
}

export const noFullText: FullTextProvider = { async getFullText() { return null; } };
