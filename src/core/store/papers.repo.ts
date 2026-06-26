// lumina-feed · papers 仓库
// upsert（稳定 rowid，FTS 经触发器同步）；search = FTS5(bm25+snippet) + 结构化过滤 + facet 计数。
import type { SqliteDb } from "./db.ts";
import type { Paper, StudyType } from "../model.ts";
import type { QuerySpec, QueryGroup } from "../querySpec.ts";

const J = (v: unknown) => JSON.stringify(v ?? null);
const P = (s: any) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };

const COLS = [
  "id", "doi", "pmid", "pmcid", "arxiv_id", "title", "abstract", "authors_json",
  "journal", "journal_abbrev", "issn", "pub_date", "year", "volume", "issue", "pages",
  "study_types_json", "primary_type", "mesh_json", "keywords_json", "language", "source",
  "is_preprint", "peer_reviewed", "retracted", "citation_count", "oa_status", "oa_url", "is_oa",
  "pdf_ref", "versions_json", "ingested_at",
] as const;

function row(p: Paper): unknown[] {
  return [
    p.id, p.doi ?? null, p.pmid ?? null, p.pmcid ?? null, p.arxivId ?? null,
    p.title, p.abstract ?? null, J(p.authors),
    p.journal ?? null, p.journalAbbrev ?? null, p.issn ?? null,
    p.pubDate ?? null, p.year ?? null, p.volume ?? null, p.issue ?? null, p.pages ?? null,
    J(p.studyTypes), p.studyTypes?.[0] ?? "other", J(p.mesh), J(p.keywords),
    p.language ?? null, p.source,
    p.isPreprint ? 1 : 0, p.peerReviewed ? 1 : 0, p.retracted ? 1 : 0,
    p.citationCount ?? null, p.oaStatus ?? null, p.oaUrl ?? null, (p.oaUrl || p.oaStatus) ? 1 : 0,
    null, J(p.versions), p.ingestedAt,
  ];
}

export class PapersRepo {
  private db: SqliteDb;
  constructor(db: SqliteDb) { this.db = db; }

  upsert(p: Paper): void {
    const cols = COLS.join(",");
    const ph = COLS.map(() => "?").join(",");
    const updates = COLS.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`).join(",");
    this.db.prepare(`INSERT INTO papers(${cols}) VALUES(${ph}) ON CONFLICT(id) DO UPDATE SET ${updates}`).run(...row(p));
  }
  upsertMany(papers: Paper[]): { inserted: number } {
    let n = 0;
    for (const p of papers) {
      const exists = this.db.prepare("SELECT 1 FROM papers WHERE id=?").get(p.id);
      this.upsert(p);
      if (!exists) n++;
    }
    return { inserted: n };
  }
  getById(id: string): Paper | undefined {
    const r = this.db.prepare("SELECT * FROM papers WHERE id=?").get(id);
    return r ? hydrate(r) : undefined;
  }
  count(): number { return (this.db.prepare("SELECT COUNT(*) n FROM papers").get() as any).n; }

  /** 检索：FTS5 + 结构化过滤 + 排序 + facet。无文本词则纯结构化。 */
  search(spec: QuerySpec, opts: { limit?: number; offset?: number; sort?: "relevance" | "date" | "citations" } = {}): SearchResponse {
    const match = buildFtsMatch(spec);
    const { where, params } = buildStructuredWhere(spec);
    const limit = opts.limit ?? 50, offset = opts.offset ?? 0;

    let baseFrom: string, baseParams: unknown[], relSelect = "", relOrder = "";
    if (match) {
      baseFrom = `FROM papers_fts JOIN papers p ON p.rowid = papers_fts.rowid WHERE papers_fts MATCH ?${where ? " AND " + where : ""}`;
      baseParams = [match, ...params];
      relSelect = `, bm25(papers_fts) AS rank, snippet(papers_fts,0,'⟦','⟧','…',10) AS title_snip, snippet(papers_fts,1,'⟦','⟧','…',14) AS abs_snip`;
      relOrder = "rank";
    } else {
      baseFrom = `FROM papers p${where ? " WHERE " + where : ""}`;
      baseParams = [...params];
      relOrder = "p.pub_date DESC";
    }
    const sort = opts.sort === "date" ? "p.pub_date DESC"
      : opts.sort === "citations" ? "p.citation_count DESC"
      : (match ? relOrder : "p.pub_date DESC");

    const total = (this.db.prepare(`SELECT COUNT(*) n ${baseFrom}`).get(...baseParams) as any).n;
    const rows = this.db.prepare(`SELECT p.*${relSelect} ${baseFrom} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...baseParams, limit, offset);

    const hits: SearchRow[] = rows.map((r: any) => ({
      paper: hydrate(r),
      snippet: r.title_snip || r.abs_snip ? { title: r.title_snip, abstract: r.abs_snip } : undefined,
      rank: r.rank,
    }));

    const facets = this.facets(baseFrom, baseParams);
    return { total, hits, facets };
  }

  private facets(baseFrom: string, baseParams: unknown[]): Facets {
    const grp = (col: string) =>
      this.db.prepare(`SELECT ${col} AS k, COUNT(*) AS n ${baseFrom} GROUP BY ${col} ORDER BY n DESC`).all(...baseParams)
        .filter((r: any) => r.k != null).map((r: any) => ({ value: String(r.k), count: r.n }));
    return {
      source: grp("p.source"),
      year: grp("p.year"),
      type: grp("p.primary_type"),
      journal: grp("p.journal").slice(0, 20),
      oa: grp("p.is_oa").map((f) => ({ value: f.value === "1" ? "open" : "closed", count: f.count })),
      preprint: grp("p.is_preprint").map((f) => ({ value: f.value === "1" ? "preprint" : "published", count: f.count })),
    };
  }
}

export interface FacetBucket { value: string; count: number }
export interface Facets { source: FacetBucket[]; year: FacetBucket[]; type: FacetBucket[]; journal: FacetBucket[]; oa: FacetBucket[]; preprint: FacetBucket[] }
export interface SearchRow { paper: Paper; snippet?: { title?: string; abstract?: string }; rank?: number }
export interface SearchResponse { total: number; hits: SearchRow[]; facets: Facets }

function hydrate(r: any): Paper {
  return {
    id: r.id, doi: r.doi ?? undefined, pmid: r.pmid ?? undefined, pmcid: r.pmcid ?? undefined, arxivId: r.arxiv_id ?? undefined,
    title: r.title, abstract: r.abstract ?? undefined, authors: P(r.authors_json) ?? [],
    journal: r.journal ?? undefined, journalAbbrev: r.journal_abbrev ?? undefined, issn: r.issn ?? undefined,
    pubDate: r.pub_date ?? undefined, year: r.year ?? undefined, volume: r.volume ?? undefined, issue: r.issue ?? undefined, pages: r.pages ?? undefined,
    studyTypes: P(r.study_types_json) ?? ["other"], mesh: P(r.mesh_json), keywords: P(r.keywords_json),
    language: r.language ?? undefined, source: r.source,
    isPreprint: !!r.is_preprint, peerReviewed: !!r.peer_reviewed, retracted: !!r.retracted,
    citationCount: r.citation_count ?? undefined, oaStatus: r.oa_status ?? undefined, oaUrl: r.oa_url ?? undefined,
    versions: P(r.versions_json) ?? [], ingestedAt: r.ingested_at,
  };
}

// ── QuerySpec → FTS5 MATCH（仅 title/abstract/tiab/all 词；author/journal 走结构化）──
function buildFtsMatch(spec: QuerySpec): string | null {
  const ftsGroups: string[] = [];
  for (const g of spec.groups) {
    const parts: string[] = [];
    for (const t of g.terms) {
      if (!["title", "abstract", "tiab", "all"].includes(t.field)) continue;
      const v = `"${t.value.replace(/"/g, '""')}"`;
      const col = t.field === "title" ? "title" : t.field === "abstract" ? "abstract" : null;
      parts.push(col ? `${col}:${v}` : v);
    }
    if (parts.length) {
      const op = g.op === "NOT" ? " NOT " : ` ${g.op} `;
      ftsGroups.push(parts.length > 1 ? `(${parts.join(op)})` : parts[0]);
    }
  }
  return ftsGroups.length ? ftsGroups.join(" AND ") : null;
}

// ── 结构化 WHERE（年份/来源/类型/OA/语言/preprint/期刊/作者 LIKE）──
function buildStructuredWhere(spec: QuerySpec): { where: string; params: unknown[] } {
  const cl: string[] = [], params: unknown[] = [];
  const f = spec.filters;
  if (f.yearFrom) { cl.push("p.year >= ?"); params.push(f.yearFrom); }
  if (f.yearTo) { cl.push("p.year <= ?"); params.push(f.yearTo); }
  if (f.sources?.length) { cl.push(`p.source IN (${f.sources.map(() => "?").join(",")})`); params.push(...f.sources); }
  if (f.types?.length) { cl.push(`p.primary_type IN (${f.types.map(() => "?").join(",")})`); params.push(...f.types); }
  if (f.openAccessOnly) cl.push("p.is_oa = 1");
  if (f.peerReviewedOnly) cl.push("p.peer_reviewed = 1");
  if (f.languages?.length) { cl.push(`p.language IN (${f.languages.map(() => "?").join(",")})`); params.push(...f.languages); }
  // author/journal 关键词作 LIKE（非 FTS 列）
  for (const g of spec.groups) for (const t of g.terms) {
    if (t.field === "journal") { cl.push("p.journal LIKE ?"); params.push(`%${t.value}%`); }
    if (t.field === "author") { cl.push("p.authors_json LIKE ?"); params.push(`%${t.value}%`); }
  }
  return { where: cl.join(" AND "), params };
}
