// lumina-feed · QuerySpec（结构化检索式，N-F2）
// 结构化 ⇄ raw 双向编译；并把 QuerySpec 翻译成各源各自语法。U3 可存档 raw。
import type { StudyType } from "./model.ts";

export type Field = "title" | "abstract" | "tiab" | "author" | "journal" | "mesh" | "all";
export type BoolOp = "AND" | "OR" | "NOT";

export interface QueryTerm { field: Field; value: string; explode?: boolean }
export interface QueryGroup { op: BoolOp; terms: QueryTerm[] }

export type SearchField = "all" | "title" | "abstract" | "tiab" | "author" | "journal";
export type SearchSort = "relevance" | "recent" | "cited";

export interface QueryFilters {
  yearFrom?: number; yearTo?: number;
  sources?: string[]; types?: StudyType[];
  peerReviewedOnly?: boolean; openAccessOnly?: boolean; languages?: string[];
  /** 检索字段范围（Find & Fetch UI 传入） */
  field?: SearchField;
  /** 排序：默认 relevance（定位），非数据库式总数 */
  sort?: SearchSort;
}

export interface QuerySpec {
  groups: QueryGroup[];
  filters: QueryFilters;
  raw?: string;
}

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
// ISSN 识别/归一（期刊订阅可填 ISSN → 各源精确过滤）
const isIssn = (v: string): boolean => /^\d{4}-?\d{3}[\dxX]$/.test(String(v).trim());
const normIssn = (v: string): string => { const d = String(v).replace(/[^0-9xX]/gi, "").toUpperCase(); return d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4) : String(v).trim(); };

/** 结构化 → raw（人类可读 / 可存档）。组间默认 AND，组内按 group.op 连接。 */
export function specToRaw(spec: QuerySpec): string {
  const groups = spec.groups
    .filter((g) => g.terms.length)
    .map((g) => {
      const parts = g.terms.map((t) => {
        const tag = t.field === "all" ? "" : `[${t.field}${t.explode ? ":exp" : ""}]`;
        return `${quote(t.value)}${tag}`;
      });
      const joined = parts.join(` ${g.op === "NOT" ? "AND NOT" : g.op} `);
      return parts.length > 1 ? `(${joined})` : joined;
    });
  return groups.join(" AND ");
}

/** raw → 结构化（宽松解析：按 AND 切组，识别 field 标签 [tiab] 等；解析不了的整体塞 all 组）。 */
// 字段别名：PubMed 风格简写 + 全称 → 内部 Field；未知标签归 all（避免下游 [undefined]）。
const FIELD_ALIAS: Record<string, Field> = {
  ti: "title", title: "title", ab: "abstract", abstract: "abstract", tiab: "tiab",
  au: "author", author: "author", ta: "journal", journal: "journal", mh: "mesh", mesh: "mesh", all: "all",
};
export function rawToSpec(raw: string, filters: QueryFilters = {}): QuerySpec {
  const text = raw.trim();
  if (!text) return { groups: [], filters, raw: text };
  const chunks = text.split(/\s+AND\s+/i).map((s) => s.replace(/^\(|\)$/g, "").trim()).filter(Boolean);
  const groups: QueryGroup[] = [];
  for (const ch of chunks) {
    const op: BoolOp = /\sOR\s/i.test(ch) ? "OR" : "AND";
    const rawTerms = ch.split(/\s+(?:OR|AND NOT|AND)\s+/i).filter(Boolean);
    const terms: QueryTerm[] = rawTerms.map((rt) => {
      const m = rt.match(/^"?([^"\[]+?)"?\s*(?:\[(\w+)(:exp)?\])?$/);
      const value = (m?.[1] ?? rt).trim();
      const field: Field = FIELD_ALIAS[(m?.[2] || "").toLowerCase()] || "all";
      return { field, value, explode: !!m?.[3] };
    }).filter((t) => t.value);
    if (terms.length) groups.push({ op, terms });
  }
  return { groups, filters, raw: text };
}

// ────────────────── 各源语法翻译 ──────────────────

/** PubMed E-utilities：字段标签 [tiab]/[ti]/[ab]/[au]/[ta]/[mesh]/[mh:noexp] */
export function toPubmedTerm(spec: QuerySpec): string {
  const pm: Record<Field, string> = { title: "Title", abstract: "Title/Abstract", tiab: "Title/Abstract", author: "Author", journal: "Journal", mesh: "MeSH Terms", all: "" };
  const groups = spec.groups.filter((g) => g.terms.length).map((g) => {
    const parts = g.terms.map((t) => {
      const tag = t.field === "all" ? "" : `[${pm[t.field]}${t.field === "mesh" && t.explode === false ? ":noexp" : ""}]`;
      return `${quote(t.value)}${tag}`;
    });
    const j = parts.join(` ${g.op === "NOT" ? "NOT" : g.op} `);
    return parts.length > 1 ? `(${j})` : j;
  });
  const f = spec.filters;
  if (f.yearFrom || f.yearTo) groups.push(`("${f.yearFrom ?? 1900}"[Date - Publication] : "${f.yearTo ?? 3000}"[Date - Publication])`);
  if (f.languages?.length) groups.push(`(${f.languages.map((l) => `${l}[Language]`).join(" OR ")})`);
  return groups.join(" AND ");
}

/** Crossref：bibliographic / query.author / query.title 等参数 + filter */
export function toCrossrefParams(spec: QuerySpec, since?: string): URLSearchParams {
  const p = new URLSearchParams();
  const bib: string[] = [], authors: string[] = [], titles: string[] = [], issns: string[] = [];
  for (const g of spec.groups) for (const t of g.terms) {
    if (t.field === "author") authors.push(t.value);
    else if (t.field === "title") titles.push(t.value);
    else if (t.field === "journal" && isIssn(t.value)) issns.push(normIssn(t.value)); // ISSN 精确过滤
    else bib.push(t.value);
  }
  if (bib.length) p.set("query.bibliographic", bib.join(" "));
  if (titles.length) p.set("query.title", titles.join(" "));
  if (authors.length) p.set("query.author", authors.join(" "));
  const filters: string[] = [];
  for (const x of issns) filters.push(`issn:${x}`);
  const from = since ? since.slice(0, 10) : spec.filters.yearFrom ? `${spec.filters.yearFrom}-01-01` : null;
  if (from) filters.push(`from-pub-date:${from}`);
  if (spec.filters.yearTo) filters.push(`until-pub-date:${spec.filters.yearTo}-12-31`);
  if (filters.length) p.set("filter", filters.join(","));
  return p;
}

/** OpenAlex：search= + filter=from_publication_date / type 等 */
export function toOpenalexParams(spec: QuerySpec, since?: string): URLSearchParams {
  const p = new URLSearchParams();
  const issns: string[] = []; const words: string[] = [];
  for (const g of spec.groups) for (const t of g.terms) {
    if (t.field === "journal" && isIssn(t.value)) issns.push(normIssn(t.value)); // ISSN 精确过滤
    else words.push(t.value);
  }
  if (words.length) p.set("search", words.join(" "));
  const filters: string[] = [];
  if (issns.length) filters.push(`primary_location.source.issn:${issns.join("|")}`);
  const from = since ? since.slice(0, 10) : spec.filters.yearFrom ? `${spec.filters.yearFrom}-01-01` : null;
  if (from) filters.push(`from_publication_date:${from}`);
  if (spec.filters.openAccessOnly) filters.push("is_oa:true");
  if (filters.length) p.set("filter", filters.join(","));
  return p;
}

/** Europe PMC：自有布尔语法 TITLE:/ABSTRACT:/AUTH:/JOURNAL: + AND/OR */
export function toEuropePmcQuery(spec: QuerySpec): string {
  const map: Partial<Record<Field, string>> = { title: "TITLE", abstract: "ABSTRACT", tiab: "TITLE_ABS", author: "AUTH", journal: "JOURNAL" };
  const groups = spec.groups.filter((g) => g.terms.length).map((g) => {
    const parts = g.terms.map((t) => {
      const pre = (t.field === "journal" && isIssn(t.value)) ? "ISSN" : map[t.field]; // ISSN 精确过滤
      return pre ? `${pre}:${quote(t.value)}` : quote(t.value);
    });
    const j = parts.join(` ${g.op === "NOT" ? "NOT" : g.op} `);
    return parts.length > 1 ? `(${j})` : j;
  });
  return groups.join(" AND ") || "*";
}

/** arXiv：ti:/abs:/au: + AND/OR/ANDNOT */
export function toArxivQuery(spec: QuerySpec): string {
  const map: Partial<Record<Field, string>> = { title: "ti", abstract: "abs", tiab: "abs", author: "au" };
  const groups = spec.groups.filter((g) => g.terms.length).map((g) => {
    const parts = g.terms.map((t) => `${map[t.field] ?? "all"}:${quote(t.value)}`);
    const op = g.op === "NOT" ? "ANDNOT" : g.op;
    const j = parts.join(` ${op} `);
    return parts.length > 1 ? `(${j})` : j;
  });
  return groups.join(" AND ") || "all:*";
}

/** bioRxiv 无关键词 API：返回扁平词表，供 details 拉取后客户端过滤 */
export function toTermList(spec: QuerySpec): string[] {
  return spec.groups.flatMap((g) => g.terms.map((t) => t.value.toLowerCase())).filter(Boolean);
}
