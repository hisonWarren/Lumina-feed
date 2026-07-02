// lumina-feed · bioRxiv / medRxiv DOI → 最新版 PDF 直链
import { biorxivPdfUrl } from "./oa-url-normalize.ts";
import type { UrlCandidate } from "./candidate.ts";
import { attemptSignal } from "./timeout.ts";

const BIORXIV_DOI = /^10\.(1101|64898)\//i;

export function isBiorxivDoi(doi?: string): boolean {
  return BIORXIV_DOI.test(String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""));
}

/** 同步候选：从新到旧尝试 vN（弥补元数据无版本 / 规则写死 v1）。 */
export function biorxivPdfCandidates(doi: string, maxVersion = 10): UrlCandidate[] {
  const d = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  if (!isBiorxivDoi(d)) return [];
  const out: UrlCandidate[] = [];
  for (let v = maxVersion; v >= 1; v--) {
    out.push({ kind: "url", url: biorxivPdfUrl(d, v, "biorxiv"), source: `biorxiv_v${v}`, priority: 6 + (maxVersion - v) });
    out.push({ kind: "url", url: biorxivPdfUrl(d, v, "medrxiv"), source: `medrxiv_v${v}`, priority: 7 + (maxVersion - v) });
  }
  return out;
}

interface BiorxivApiRow { doi?: string; version?: string | number; server?: string }

/** bioRxiv details API：返回该 DOI 最新版本号（失败则 null）。 */
export async function fetchBiorxivLatestVersion(
  doi: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<{ version: number; server: "biorxiv" | "medrxiv" } | null> {
  const d = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  if (!isBiorxivDoi(d)) return null;
  const f = fetchImpl ?? fetch;
  const attempt = attemptSignal(signal, 10_000);
  try {
    for (const server of ["biorxiv", "medrxiv"] as const) {
      try {
        const res = await f(`https://api.biorxiv.org/details/${server}/${d}/na/json`, {
          headers: { accept: "application/json" },
          signal: attempt.signal,
        });
        if (!res.ok) continue;
        const json = await res.json();
        const rows: BiorxivApiRow[] = json?.collection ?? [];
        let best = 0;
        for (const row of rows) {
          const v = Number(row.version ?? 0);
          if (v > best) best = v;
        }
        if (best > 0) return { version: best, server };
      } catch { /* try next server */ }
    }
    return null;
  } finally {
    attempt.clear();
  }
}

/** API 解析最新版 → 高优先级 PDF 候选。prefetchedLatest 可避免重复请求 details API。 */
export async function biorxivApiPdfCandidates(
  doi: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  prefetchedLatest?: { version: number; server: "biorxiv" | "medrxiv" } | null,
): Promise<UrlCandidate[]> {
  const d = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  const latest = prefetchedLatest !== undefined
    ? prefetchedLatest
    : await fetchBiorxivLatestVersion(d, fetchImpl, signal);
  if (!latest) return [];
  const url = biorxivPdfUrl(d, latest.version, latest.server);
  const alt = latest.server === "biorxiv"
    ? biorxivPdfUrl(d, latest.version, "medrxiv")
    : biorxivPdfUrl(d, latest.version, "biorxiv");
  return [
    { kind: "url", url, source: "biorxiv_api_latest", priority: 4 },
    { kind: "url", url: alt, source: "biorxiv_api_alt_host", priority: 5 },
  ];
}
