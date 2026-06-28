// P10 · 标识符直达预取：仅高置信 DOI 解析成功时后台取文
export const HIGH_CONFIDENCE_SOURCES = new Set([
  "crossref", "openalex", "pubmed", "europepmc", "arxiv", "datacite",
]);

export function shouldPrefetchIdentifier(
  locateMode: string | undefined,
  resolvedFrom: string[] | undefined,
  paper: { doi?: string | null } | null | undefined,
  settings: { prefetchOnIdentifier?: boolean },
  hasPdf: boolean,
): boolean {
  if (!settings.prefetchOnIdentifier) return false;
  if (locateMode !== "identifier") return false;
  if (!paper?.doi) return false;
  if (hasPdf) return false;
  const from = resolvedFrom ?? [];
  if (from.length === 1 && from[0] === "doi_stub") return false;
  return from.some((f) => HIGH_CONFIDENCE_SOURCES.has(f));
}
