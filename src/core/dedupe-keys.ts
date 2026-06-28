// src/core/dedupe-keys.ts
// Extended dedupe keys (fixes review F6). Drop-in for dedupeKey() in dedupe.ts:
//   priority: doi → pmid → pmcid → arxiv → s2 → fingerprint.
// Requires SearchHit to optionally carry `s2Id` (set by the Semantic Scholar adapter).
// Wire: in dedupe.ts, change dedupeKey body to `return dedupeKeyExt(h);`
import type { SearchHit, Paper } from "./model.ts";

export function normDoi(doi?: string): string | undefined {
  if (!doi) return undefined;
  return doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/\s+/g, "");
}
function titleFingerprint(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
const lastName = (a?: string) => (a ? a.split(/[\s,]+/).filter(Boolean).pop() ?? a : "").toLowerCase();

export function dedupeKeyExt(h: (SearchHit | Paper) & { s2Id?: string }): string {
  const doi = normDoi((h as any).doi);              if (doi) return `doi:${doi}`;
  const pmid = (h as any).pmid;                     if (pmid) return `pmid:${String(pmid).trim()}`;
  const pmcid = (h as any).pmcid;                   if (pmcid) return `pmcid:${String(pmcid).replace(/^PMC/i, "")}`;
  const arx = (h as any).arxivId;                   if (arx) return `arxiv:${String(arx).replace(/v\d+$/, "")}`;
  const s2 = (h as any).s2Id;                       if (s2) return `s2:${s2}`;
  const fp = titleFingerprint(h.title ?? "");
  return `fp:${fp}|${lastName(h.authors?.[0])}|${h.year ?? ""}`;
}
