// P10 · 预取资格：定位命中 + OA 检索结果（默认积极预取）
import type { Paper } from "../model.ts";
import { isOaMarkedPaper } from "../oa/provider.ts";

export const HIGH_CONFIDENCE_SOURCES = new Set([
  "crossref", "openalex", "pubmed", "europepmc", "arxiv", "datacite", "local", "title_fast_lane",
]);

export type PrefetchSettings = {
  prefetchOnIdentifier?: boolean;
  prefetchOaResults?: boolean;
};

/** 标识符/Primary 定位预取（默认开，显式 false 才关） */
export function shouldPrefetchOnLocate(
  locateMode: string | undefined,
  resolvedFrom: string[] | undefined,
  paper: { doi?: string | null } | null | undefined,
  settings: PrefetchSettings,
  hasPdf: boolean,
): boolean {
  if (settings.prefetchOnIdentifier === false) return false;
  if (locateMode !== "identifier" && locateMode !== "primary") return false;
  if (!paper?.doi) return false;
  if (hasPdf) return false;
  const from = resolvedFrom ?? [];
  if (from.length === 1 && from[0] === "doi_stub") return false;
  if (locateMode === "primary") {
    return from.some((f) => HIGH_CONFIDENCE_SOURCES.has(f));
  }
  return from.some((f) => HIGH_CONFIDENCE_SOURCES.has(f));
}

/** 检索结果 gold/green OA 卡片预取（默认开） */
export function shouldPrefetchOaResult(
  paper: Pick<Paper, "doi" | "oaStatus" | "oaUrl" | "pmcid" | "arxivId"> | null | undefined,
  settings: PrefetchSettings,
  hasPdf: boolean,
): boolean {
  if (settings.prefetchOaResults === false) return false;
  if (hasPdf) return false;
  if (!paper) return false;
  if (!paper.doi && !paper.oaUrl && !paper.pmcid && !paper.arxivId) return false;
  return isOaMarkedPaper(paper as Paper);
}

/** @deprecated use shouldPrefetchOnLocate */
export function shouldPrefetchIdentifier(
  locateMode: string | undefined,
  resolvedFrom: string[] | undefined,
  paper: { doi?: string | null } | null | undefined,
  settings: PrefetchSettings,
  hasPdf: boolean,
): boolean {
  return shouldPrefetchOnLocate(locateMode, resolvedFrom, paper, settings, hasPdf);
}
