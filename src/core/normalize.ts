// lumina-feed · 归一化 SearchHit → Paper
import type { SearchHit, Paper, StudyType } from "./model.ts";
import { dedupeKey } from "./dedupe.ts";

/** 从标题/期刊弱推断研究类型（M1 粗粒度；M6 可接更强分类） */
export function inferTypes(h: SearchHit): StudyType[] {
  if (h.type?.length) return h.type;
  if (h.isPreprint) return ["preprint"];
  const t = `${h.title} ${h.journal ?? ""}`.toLowerCase();
  const out: StudyType[] = [];
  if (/\bmeta-?analysis\b/.test(t)) out.push("meta-analysis");
  if (/\bsystematic review\b/.test(t)) out.push("systematic-review");
  if (/\brandomi[sz]ed|randomised controlled|\brct\b/.test(t)) out.push("rct");
  if (/\bcohort\b/.test(t)) out.push("cohort");
  if (/\bcase[- ]control\b/.test(t)) out.push("case-control");
  if (/\bguideline|consensus statement\b/.test(t)) out.push("guideline");
  if (/\breview\b/.test(t) && !out.length) out.push("review");
  return out.length ? out : ["other"];
}

export function normalize(h: SearchHit): Paper {
  const studyTypes = inferTypes(h);
  return {
    id: dedupeKey(h),
    doi: h.doi,
    pmid: h.pmid,
    pmcid: h.pmcid,
    arxivId: h.arxivId,
    title: (h.title ?? "").trim(),
    abstract: h.abstract?.trim(),
    authors: h.authors ?? [],
    journal: h.journal,
    journalAbbrev: h.journal ? abbrev(h.journal) : undefined,
    pubDate: h.pubDate,
    year: h.year ?? (h.pubDate ? new Date(h.pubDate).getUTCFullYear() : undefined),
    studyTypes,
    language: h.language ?? "eng",
    source: h.source,
    isPreprint: !!h.isPreprint,
    peerReviewed: h.peerReviewed ?? !h.isPreprint,
    retracted: !!h.retracted,
    citationCount: h.citationCount,
    oaStatus: h.oaStatus,
    oaUrl: h.oaUrl,
    relatedDoi: h.relatedDoi,
    versions: [{ source: h.source, doi: h.doi, isPreprint: !!h.isPreprint, pubDate: h.pubDate, year: h.year, oaUrl: h.oaUrl }],
    ingestedAt: new Date().toISOString(),
  };
}

function abbrev(journal: string): string {
  // 极简期刊缩写：取各词首段（真实可接 ISO4 词表）
  return journal.split(/\s+/).map((w) => (w.length > 4 ? w.slice(0, 4) + "." : w)).join(" ");
}
