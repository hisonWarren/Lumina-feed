// lumina-feed · M6 导出 · RIS + CSL-JSON
import type { Paper } from "../model.ts";
import { splitName } from "./bibtex.ts";

/** RIS（EndNote/Zotero/Mendeley 通用）。preprint → TY UNPB。 */
export function toRis(p: Paper): string {
  const lines: string[] = [];
  lines.push(`TY  - ${p.isPreprint ? "UNPB" : "JOUR"}`);
  for (const a of p.authors ?? []) { const n = splitName(a); lines.push(`AU  - ${n.given ? `${n.family}, ${n.given}` : n.family}`); }
  lines.push(`TI  - ${p.title ?? ""}`);
  if (p.journal) lines.push(`${p.isPreprint ? "PB" : "JO"}  - ${p.journal}`);
  if (p.year) lines.push(`PY  - ${p.year}`);
  if (p.volume) lines.push(`VL  - ${p.volume}`);
  if (p.issue) lines.push(`IS  - ${p.issue}`);
  if (p.pages) lines.push(`SP  - ${p.pages}`);
  if (p.doi) lines.push(`DO  - ${p.doi}`);
  const url = p.oaUrl ?? (p.doi ? `https://doi.org/${p.doi}` : undefined);
  if (url) lines.push(`UR  - ${url}`);
  if (p.abstract) lines.push(`AB  - ${p.abstract.replace(/\s+/g, " ").trim()}`);
  if (p.isPreprint) lines.push("N1  - Preprint, not peer-reviewed");
  if (p.retracted) lines.push("N1  - RETRACTED");
  lines.push("ER  - ");
  return lines.join("\n");
}

export function toRisAll(papers: Paper[]): string {
  return papers.map(toRis).join("\n\n") + "\n";
}

/** CSL-JSON（Zotero / pandoc / citeproc）。 */
export function toCsl(p: Paper): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: p.id,
    type: p.isPreprint ? "manuscript" : "article-journal",
    title: p.title,
    author: (p.authors ?? []).map((a) => { const n = splitName(a); return { family: n.family, given: n.given || undefined }; }),
  };
  if (p.journal) item["container-title"] = p.journal;
  if (p.year) item.issued = { "date-parts": [[p.year]] };
  if (p.volume) item.volume = p.volume;
  if (p.issue) item.issue = p.issue;
  if (p.pages) item.page = p.pages;
  if (p.doi) item.DOI = p.doi;
  const url = p.oaUrl ?? (p.doi ? `https://doi.org/${p.doi}` : undefined);
  if (url) item.URL = url;
  if (p.abstract) item.abstract = p.abstract;
  if (p.isPreprint) item.note = "Preprint, not peer-reviewed";
  if (p.retracted) item.note = [item.note, "RETRACTED"].filter(Boolean).join("; ");
  return item;
}

export function toCslAll(papers: Paper[]): string {
  return JSON.stringify(papers.map(toCsl), null, 2);
}
