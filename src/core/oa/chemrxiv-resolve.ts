// lumina-feed · ChemRxiv（Cambridge Open Engage API）→ PDF 直链
import type { UrlCandidate } from "./candidate.ts";

const CHEMRXIV_DOI = /^10\.26434\/chemrxiv/i;

export function isChemrxivDoi(doi?: string): boolean {
  return CHEMRXIV_DOI.test(String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""));
}

interface EngageItem {
  asset?: { url?: string; original?: { url?: string } };
}

function pdfFromItem(item: EngageItem | null | undefined): string | undefined {
  const asset = item?.asset;
  if (!asset || typeof asset !== "object") return undefined;
  const orig = asset.original;
  if (orig && typeof orig === "object" && orig.url) return orig.url;
  return asset.url;
}

/** Cambridge Open Engage public API */
export async function fetchChemrxivPdfUrl(
  doi: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const d = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  if (!isChemrxivDoi(d)) return undefined;
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(
      `https://www.cambridge.org/engage/coe/public-api/v1/items/doi/${encodeURIComponent(d)}`,
      { headers: { accept: "application/json" }, signal },
    );
    if (!res.ok) return undefined;
    const json = await res.json();
    return pdfFromItem(json?.item ?? json);
  } catch {
    return undefined;
  }
}

export async function chemrxivPdfCandidates(
  doi: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<UrlCandidate[]> {
  const url = await fetchChemrxivPdfUrl(doi, fetchImpl, signal);
  return url ? [{ kind: "url", url, source: "chemrxiv_api", priority: 5 }] : [];
}
