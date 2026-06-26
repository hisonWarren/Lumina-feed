// lumina-feed · 去重 + 版本归并（N-F3）
// 去重键：① DOI 规范化；② 无 DOI → 标题指纹+首作者姓+年；③ 标题 Jaccard 模糊兜底。
// 版本归并：preprint 与正式发表经 DOI 关系合并为一条带 versions[]，取「正式/最新」为代表。
import type { SearchHit, Paper } from "./model.ts";

export function normDoi(doi?: string): string | undefined {
  if (!doi) return undefined;
  return doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/\s+/g, "");
}

export function titleFingerprint(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const lastName = (a?: string) => (a ? a.split(/[\s,]+/).filter(Boolean).pop() ?? a : "").toLowerCase();

/** 单条命中的去重键 */
export function dedupeKey(h: SearchHit | Paper): string {
  const doi = normDoi((h as any).doi);
  if (doi) return `doi:${doi}`;
  const fp = titleFingerprint(h.title ?? "");
  const a = lastName(h.authors?.[0]);
  return `fp:${fp}|${a}|${h.year ?? ""}`;
}

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ")), sb = new Set(b.split(" "));
  if (!sa.size || !sb.size) return 0;
  let inter = 0; for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** 跨源去重 + 版本归并。输入归一化后的 Paper[]，输出合并后的 Paper[]。 */
export function dedupeAndMerge(papers: Paper[]): Paper[] {
  const byKey = new Map<string, Paper>();
  // 先按精确键合并
  for (const p of papers) {
    const k = p.id;
    const exist = byKey.get(k);
    byKey.set(k, exist ? mergeTwo(exist, p) : p);
  }
  let merged = [...byKey.values()];

  // 版本归并：用 relatedDoi（来自 Crossref/bioRxiv 的关系）把 preprint 与 published 串起来
  const doiIndex = new Map<string, Paper>();
  for (const p of merged) if (p.doi) doiIndex.set(normDoi(p.doi)!, p);
  const absorbed = new Set<string>();
  for (const p of merged) {
    const rel = normDoi(p.relatedDoi);
    if (rel && doiIndex.has(rel) && doiIndex.get(rel) !== p) {
      const other = doiIndex.get(rel)!;
      const survivor = preferPublished(p, other);
      const absorbedOne = survivor === p ? other : p;
      mergeInto(survivor, absorbedOne);
      absorbed.add(absorbedOne.id);
    }
  }
  merged = merged.filter((p) => !absorbed.has(p.id));

  // 模糊兜底：同年、无 DOI、标题 Jaccard ≥ .9 视为同一篇
  const out: Paper[] = [];
  for (const p of merged) {
    const dup = out.find((q) => !q.doi && !p.doi && q.year === p.year && jaccard(titleFingerprint(q.title), titleFingerprint(p.title)) >= 0.9);
    if (dup) mergeInto(dup, p); else out.push(p);
  }
  return out;
}

/** 代表条目偏好：正式发表 > preprint；同性质取被引多/日期新 */
function preferPublished(a: Paper, b: Paper): Paper {
  if (a.isPreprint !== b.isPreprint) return a.isPreprint ? b : a;
  const ca = a.citationCount ?? -1, cb = b.citationCount ?? -1;
  if (ca !== cb) return ca > cb ? a : b;
  return (a.pubDate ?? "") >= (b.pubDate ?? "") ? a : b;
}

function mergeTwo(a: Paper, b: Paper): Paper {
  const survivor = preferPublished(a, b);
  const other = survivor === a ? b : a;
  mergeInto(survivor, other);
  return survivor;
}

/** 把 other 并入 survivor：补全空字段、并 versions、取最大被引 */
function mergeInto(survivor: Paper, other: Paper): void {
  survivor.doi ??= other.doi;
  survivor.pmid ??= other.pmid;
  survivor.pmcid ??= other.pmcid;
  survivor.arxivId ??= other.arxivId;
  survivor.abstract ??= other.abstract;
  survivor.journal ??= other.journal;
  survivor.oaUrl ??= other.oaUrl;
  survivor.oaStatus ??= other.oaStatus;
  if ((other.citationCount ?? -1) > (survivor.citationCount ?? -1)) survivor.citationCount = other.citationCount;
  if (other.retracted) survivor.retracted = true;
  if (!survivor.authors?.length && other.authors?.length) survivor.authors = other.authors;
  const seen = new Set(survivor.versions.map((v) => `${v.source}:${v.doi ?? ""}`));
  for (const v of other.versions) { const k = `${v.source}:${v.doi ?? ""}`; if (!seen.has(k)) { survivor.versions.push(v); seen.add(k); } }
  survivor.versions.sort((x, y) => (y.pubDate ?? "").localeCompare(x.pubDate ?? ""));
}
