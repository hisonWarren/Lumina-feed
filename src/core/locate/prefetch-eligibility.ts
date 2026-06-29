// P10 · 预取资格：须在设置中显式开启；标题完全匹配（primary）永不预取
import type { Paper } from "../model.ts";
import { isOaMarkedPaper } from "../oa/provider.ts";

export const HIGH_CONFIDENCE_SOURCES = new Set([
  "crossref", "openalex", "pubmed", "europepmc", "arxiv", "datacite", "local", "title_fast_lane",
]);

export type PrefetchSettings = {
  prefetchOnIdentifier?: boolean;
  prefetchOaResults?: boolean;
};

/** 标识符定位预取（须在设置中显式开启） */
export function shouldPrefetchOnLocate(
  locateMode: string | undefined,
  resolvedFrom: string[] | undefined,
  paper: { doi?: string | null } | null | undefined,
  settings: PrefetchSettings,
  hasPdf: boolean,
): boolean {
  if (settings.prefetchOnIdentifier !== true) return false;
  if (locateMode !== "identifier") return false;
  if (!paper?.doi) return false;
  if (hasPdf) return false;
  const from = resolvedFrom ?? [];
  if (from.length === 1 && from[0] === "doi_stub") return false;
  return from.some((f) => HIGH_CONFIDENCE_SOURCES.has(f));
}

/** 检索结果 gold/green OA 卡片预取（须在设置中显式开启） */
export function shouldPrefetchOaResult(
  paper: Pick<Paper, "doi" | "oaStatus" | "oaUrl" | "pmcid" | "arxivId"> | null | undefined,
  settings: PrefetchSettings,
  hasPdf: boolean,
): boolean {
  if (settings.prefetchOaResults !== true) return false;
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
