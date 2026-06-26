// lumina-feed · PDF 候选（OA + 备选渠道统一排序，不区分类别）
export interface UrlCandidate {
  kind: "url";
  url: string;
  source: string;
  priority: number;
}

export interface ScihubCandidate {
  kind: "scihub";
  doi: string;
  source: "scihub";
  priority: number;
}

export type PdfCandidate = UrlCandidate | ScihubCandidate;

export function dedupeCandidates(cands: PdfCandidate[]): PdfCandidate[] {
  const seen = new Set<string>();
  const out: PdfCandidate[] = [];
  for (const c of [...cands].sort((a, b) => a.priority - b.priority)) {
    const key = c.kind === "url" ? c.url : `scihub:${c.doi}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
