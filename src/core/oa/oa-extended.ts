// src/core/oa/oa-extended.ts
// OA-chain extensions (P3) + missing_email sentinel (P0 — fixes the silent Unpaywall dead-code).
// Pure UrlCandidate producers, mirroring oa-resolver.ts. Add into resolvePdfCandidates' allSettled.
import type { UrlCandidate } from "./candidate.ts";

export interface MissingEmail { kind: "missing_email"; source: "unpaywall"; priority: 999; }
export const MISSING_EMAIL: MissingEmail = { kind: "missing_email", source: "unpaywall", priority: 999 };
/** true when Unpaywall WOULD help (DOI present) but is skipped for lack of a contact email. */
export function shouldSignalMissingEmail(doi: string | undefined, email: string | undefined): boolean {
  return !!doi && !email;
}

/** 仅在 OA 未命中且缺邮箱时覆盖为 missing_email；其他失败保留真实 reason，避免误导用户。 */
export function maybeMissingEmailReason(
  doi: string | undefined,
  email: string | undefined,
  reason: string,
): "missing_email" | null {
  if (!shouldSignalMissingEmail(doi, email)) return null;
  const r = String(reason || "").toLowerCase();
  if (r === "identity_mismatch" || r === "publisher_blocked") return null;
  if (/timeout|timed out|超时/.test(r)) return null;
  if (r === "no_pdf" || r === "no_oa" || !r) return "missing_email";
  return null;
}

type Fetch = typeof fetch;
async function getJson(url: string, f: Fetch, signal?: AbortSignal, bearer?: string): Promise<any | null> {
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    const res = await f(url, { headers, signal, redirect: "follow" } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function fromCore(doi: string, f: Fetch, signal?: AbortSignal, key?: string): Promise<UrlCandidate[]> {
  if (!key) return [];                                     // CORE requires a key (graceful skip)
  const data = await getJson(`https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(`doi:"${doi}"`)}&limit=1`, f, signal, key);
  const url = data?.results?.[0]?.downloadUrl;
  return url ? [{ kind: "url", url, source: "core", priority: 28 }] : [];
}
export async function fromDoaj(doi: string, f: Fetch, signal?: AbortSignal): Promise<UrlCandidate[]> {
  const data = await getJson(`https://doaj.org/api/v3/search/articles/${encodeURIComponent(`doi:${doi}`)}?pageSize=1`, f, signal);
  const ft = (data?.results?.[0]?.bibjson?.link ?? []).find((l: any) => String(l.type).toLowerCase() === "fulltext")?.url;
  return ft ? [{ kind: "url", url: ft, source: "doaj", priority: 18 }] : [];
}
export async function fromHal(doi: string, f: Fetch, signal?: AbortSignal): Promise<UrlCandidate[]> {
  const data = await getJson(`https://api.archives-ouvertes.fr/search/?q=doiId_s:${encodeURIComponent(doi)}&fl=fileMain_s,files_s&rows=1&wt=json`, f, signal);
  const doc = data?.response?.docs?.[0];
  const url = doc?.fileMain_s || (Array.isArray(doc?.files_s) ? doc.files_s[0] : undefined);
  return url ? [{ kind: "url", url, source: "hal", priority: 19 }] : [];
}
export async function fromZenodo(doi: string, f: Fetch, signal?: AbortSignal): Promise<UrlCandidate[]> {
  const data = await getJson(`https://zenodo.org/api/records?q=${encodeURIComponent(`doi:"${doi}"`)}&size=1`, f, signal);
  const file = (data?.hits?.hits?.[0]?.files ?? []).find((x: any) => /\.pdf$/i.test(String(x.key)));
  const pdf = file?.links?.self ?? file?.links?.download;
  return pdf ? [{ kind: "url", url: pdf, source: "zenodo", priority: 24 }] : [];
}
export async function fromDatacite(doi: string, f: Fetch, signal?: AbortSignal): Promise<UrlCandidate[]> {
  const data = await getJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, f, signal);
  const url = data?.data?.attributes?.url;                 // landing page (not always a direct PDF)
  return url ? [{ kind: "url", url, source: "datacite_landing", priority: 60 }] : [];
}
