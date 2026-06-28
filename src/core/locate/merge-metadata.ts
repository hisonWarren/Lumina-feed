// locate · 多源 metadata 合并为单条 SearchHit
import type { SearchHit } from "../model.ts";

export function mergeMetadataHits(hits: SearchHit[], primarySource = "resolve"): SearchHit | null {
  const list = hits.filter((h) => h?.title?.trim());
  if (!list.length) return hits[0] ?? null;

  const merged: SearchHit = { ...list[0], source: primarySource };
  for (const h of list.slice(1)) {
    if (!merged.abstract && h.abstract) merged.abstract = h.abstract;
    if (!merged.doi && h.doi) merged.doi = h.doi;
    if (!merged.pmid && h.pmid) merged.pmid = h.pmid;
    if (!merged.pmcid && h.pmcid) merged.pmcid = h.pmcid;
    if (!merged.arxivId && h.arxivId) merged.arxivId = h.arxivId;
    if (!merged.journal && h.journal) merged.journal = h.journal;
    if (!merged.year && h.year) merged.year = h.year;
    if (!merged.pubDate && h.pubDate) merged.pubDate = h.pubDate;
    if (!merged.oaUrl && h.oaUrl) merged.oaUrl = h.oaUrl;
    if (!merged.oaStatus && h.oaStatus) merged.oaStatus = h.oaStatus;
    if (h.authors?.length && (!merged.authors?.length || merged.authors.length < h.authors.length)) {
      merged.authors = h.authors;
    }
    if (h.citationCount != null && (merged.citationCount == null || h.citationCount > merged.citationCount)) {
      merged.citationCount = h.citationCount;
    }
    if (h.retracted) merged.retracted = true;
    if (h.isPreprint != null && merged.isPreprint == null) merged.isPreprint = h.isPreprint;
    if (h.peerReviewed != null && merged.peerReviewed == null) merged.peerReviewed = h.peerReviewed;
    if (!merged.relatedDoi && h.relatedDoi) merged.relatedDoi = h.relatedDoi;
  }
  return merged;
}
