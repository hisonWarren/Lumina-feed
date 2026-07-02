// lumina-feed · 渲染层卡片 → 引擎 Paper（取文前补库；流式检索应直接 upsert 引擎 Paper）
import type { Paper, StudyType } from "./model.ts";
import { isBiorxivDoi } from "./oa/biorxiv-resolve.ts";

const OA_UI: Record<string, string> = {
  gold: "gold",
  green: "green",
  closed: "closed",
};

function studyTypesFromCard(card: Record<string, unknown>): StudyType[] {
  if (Array.isArray(card.studyTypes) && card.studyTypes.length) {
    return card.studyTypes as StudyType[];
  }
  const t = String(card.type || "").toLowerCase();
  if (t === "preprint") return ["preprint"];
  if (t === "review") return ["review"];
  if (t === "rct") return ["rct"];
  return ["other"];
}

/** @param card FindFetch / toCardModel 形状或引擎 Paper 子集 */
export function paperFromCard(card: unknown): Paper | null {
  if (!card || typeof card !== "object") return null;
  const c = card as Record<string, unknown>;
  const id = String(c.id || "").trim();
  if (!id) return null;
  const oaRaw = String(c.oaStatus || c.oa || "unknown").toLowerCase();
  const doiNorm = c.doi
    ? String(c.doi).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    : "";
  const preprintDoi = isBiorxivDoi(doiNorm);
  let oaStatus = OA_UI[oaRaw] || oaRaw;
  if (preprintDoi && (!oaStatus || oaStatus === "unknown" || oaStatus === "closed")) {
    oaStatus = "gold";
  }
  const versions = Array.isArray(c.versions) ? c.versions : [];
  const source = versions.length && typeof versions[0] === "object" && versions[0]
    ? String((versions[0] as { source?: string }).source || "search")
    : "search";
  const cites = c.cites ?? c.citationCount;
  return {
    id,
    doi: c.doi ? String(c.doi) : undefined,
    title: String(c.title || id),
    abstract: c.abstract ? String(c.abstract) : undefined,
    authors: Array.isArray(c.authors) ? c.authors.map((a) => String(a)) : [],
    journal: c.journal ? String(c.journal) : undefined,
    journalAbbrev: c.abbr ? String(c.abbr) : undefined,
    year: c.year != null && c.year !== "" ? Number(c.year) : undefined,
    pubDate: c.pubDate ? String(c.pubDate) : undefined,
    studyTypes: studyTypesFromCard(c),
    source,
    isPreprint: !!(c.isPreprint ?? c.preprint ?? preprintDoi),
    peerReviewed: !!(c.peerReviewed ?? c.peer),
    retracted: !!c.retracted,
    citationCount: cites != null && cites !== "" ? Number(cites) : undefined,
    oaStatus,
    oaUrl: c.oaUrl ? String(c.oaUrl) : undefined,
    versions: versions as Paper["versions"],
    ingestedAt: new Date().toISOString(),
  };
}

export function ensurePaperFromCard(
  getById: (id: string) => Paper | undefined,
  upsert: (p: Paper) => void,
  card: unknown,
): boolean {
  const paper = paperFromCard(card);
  if (!paper) return false;
  if (getById(paper.id)) return true;
  upsert(paper);
  return true;
}
