// lumina-feed · M6 导出 · BibTeX
import type { Paper } from "../model.ts";

/** 姓名拆分：末词为姓，其余为名（启发式；兼容 "Given Family" 与 "Family GI"）。 */
export function splitName(name: string): { family: string; given: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0], given: "" };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

const bibEscape = (s: string) =>
  String(s ?? "").replace(/[{}]/g, "").replace(/&/g, "\\&").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/#/g, "\\#");

function citeKey(p: Paper): string {
  const fam = p.authors?.[0] ? splitName(p.authors[0]).family : "anon";
  const word = (p.title ?? "").split(/\s+/).find((w) => w.length > 3) ?? "ref";
  return `${fam}${p.year ?? ""}${word}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 单条 Paper → BibTeX 条目（preprint → @misc，含 note 标注未评议）。 */
export function toBibtex(p: Paper): string {
  const type = p.isPreprint ? "misc" : "article";
  const authors = (p.authors ?? []).map((a) => { const n = splitName(a); return n.given ? `${n.family}, ${n.given}` : n.family; }).join(" and ");
  const fields: Array<[string, string | undefined]> = [
    ["title", p.title ? `{${bibEscape(p.title)}}` : undefined],
    ["author", authors ? `{${authors}}` : undefined],
    [p.isPreprint ? "howpublished" : "journal", p.journal ? `{${bibEscape(p.journal)}}` : undefined],
    ["year", p.year ? String(p.year) : undefined],
    ["volume", p.volume ? `{${p.volume}}` : undefined],
    ["number", p.issue ? `{${p.issue}}` : undefined],
    ["pages", p.pages ? `{${p.pages}}` : undefined],
    ["doi", p.doi ? `{${p.doi}}` : undefined],
    ["url", p.oaUrl ? `{${p.oaUrl}}` : p.doi ? `{https://doi.org/${p.doi}}` : undefined],
    ["note", p.isPreprint ? "{Preprint, not peer-reviewed}" : p.retracted ? "{RETRACTED}" : undefined],
  ];
  const body = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = ${v}`).join(",\n");
  return `@${type}{${citeKey(p)},\n${body}\n}`;
}

export function toBibtexAll(papers: Paper[]): string {
  return papers.map(toBibtex).join("\n\n") + "\n";
}
