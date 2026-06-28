// P10 · 标识符/标题精确命中预取：高置信定位时后台取文
export const HIGH_CONFIDENCE_SOURCES = new Set([
  "crossref", "openalex", "pubmed", "europepmc", "arxiv", "datacite", "local", "title_fast_lane",
]);

export function shouldPrefetchOnLocate(
  locateMode: string | undefined,
  resolvedFrom: string[] | undefined,
  paper: { doi?: string | null } | null | undefined,
  settings: { prefetchOnIdentifier?: boolean },
  hasPdf: boolean,
): boolean {
  if (!settings.prefetchOnIdentifier) return false;
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

/** @deprecated use shouldPrefetchOnLocate */
export function shouldPrefetchIdentifier(
  locateMode: string | undefined,
  resolvedFrom: string[] | undefined,
  paper: { doi?: string | null } | null | undefined,
  settings: { prefetchOnIdentifier?: boolean },
  hasPdf: boolean,
): boolean {
  return shouldPrefetchOnLocate(locateMode, resolvedFrom, paper, settings, hasPdf);
}
