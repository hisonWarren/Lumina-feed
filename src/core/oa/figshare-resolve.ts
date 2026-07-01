// lumina-feed · Figshare DOI → PDF 直链
import type { UrlCandidate } from "./candidate.ts";

const FIGSHARE_DOI = /^10\.6084\/m9\.figshare/i;

export function isFigshareDoi(doi?: string): boolean {
  return FIGSHARE_DOI.test(String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""));
}

export async function fetchFigsharePdfUrl(
  doi: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const d = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  if (!isFigshareDoi(d)) return undefined;
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(
      `https://api.figshare.com/v2/articles?doi=${encodeURIComponent(d)}`,
      { headers: { accept: "application/json" }, signal },
    );
    if (!res.ok) return undefined;
    const rows = await res.json();
    const art = Array.isArray(rows) ? rows[0] : undefined;
    const files: { name?: string; download_url?: string }[] = art?.files ?? [];
    const pdf = files.find((x) => /\.pdf$/i.test(String(x.name || "")));
    return pdf?.download_url;
  } catch {
    return undefined;
  }
}

export async function figsharePdfCandidates(
  doi: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<UrlCandidate[]> {
  const url = await fetchFigsharePdfUrl(doi, fetchImpl, signal);
  return url ? [{ kind: "url", url, source: "figshare_api", priority: 6 }] : [];
}
