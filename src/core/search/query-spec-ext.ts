// src/core/search/query-spec-ext.ts
// Relevance-default query builders for the NEW sources (consistent with finish_all query-spec.ts).
import type { Field, SortMode, YearRange, SourceQuery } from "./query-spec.ts";

// Semantic Scholar /graph/v1/paper/search — custom relevance ranker by default (no sort param).
export function semanticscholar(q: string, _field: Field, _sort: SortMode, yr: YearRange = {}): SourceQuery {
  const p: Record<string, string> = {
    query: q,
    fields: "title,abstract,year,authors,externalIds,openAccessPdf,venue,publicationTypes,citationCount,publicationDate",
  };
  if (yr.from || yr.to) p.year = `${yr.from ?? ""}-${yr.to ?? ""}`;
  return { params: p };
}

// DOAJ /api/v3/search/articles/{query} — query in PATH; relevance default.
export function doaj(q: string, field: Field): { path: string; params: Record<string, string> } {
  let query = q;
  if (field === "title") query = `bibjson.title:(${q})`;
  else if (field === "author") query = `bibjson.author.name:(${q})`;
  return { path: query, params: {} };
}

// DataCite /dois — query param; relevance default.
export function datacite(q: string, field: Field, _sort: SortMode, yr: YearRange = {}): SourceQuery {
  let query = field === "title" ? `titles.title:(${q})` : q;
  if (yr.from || yr.to) query = `(${query}) AND publicationYear:[${yr.from ?? 1800} TO ${yr.to ?? 3000}]`;
  return { params: { query } };
}

export function core(q: string, field: Field, _sort: SortMode, yr: YearRange = {}): SourceQuery {
  let query = q;
  if (field === "title") query = `title:(${q})`;
  else if (field === "author") query = `authors.name:(${q})`;
  if (yr.from) query = `(${query}) AND yearPublished>=${yr.from}`;
  if (yr.to) query = `(${query}) AND yearPublished<=${yr.to}`;
  return { params: { q: query } };
}

export function hal(q: string, field: Field): SourceQuery {
  let query = q;
  if (field === "title") query = `title_t:(${q})`;
  else if (field === "author") query = `authFullName_t:(${q})`;
  return { params: { q: query } };
}

export function osf(q: string, _field: Field): SourceQuery {
  return { params: { q } };
}

export function zenodo(q: string, field: Field, sort: SortMode): SourceQuery {
  let query = q;
  if (field === "title") query = `title:"${q}"`;
  const p: Record<string, string> = { q: query };
  if (sort === "relevance" || !sort) p.sort = "bestmatch";
  return { params: p };
}

export function openaire(q: string, _field: Field): SourceQuery {
  return { params: { keywords: q } };
}

export function dblp(q: string, field: Field): SourceQuery {
  let query = q;
  if (field === "title") query = `title:${q}:`;
  else if (field === "author") query = `author:${q}:`;
  return { params: { q: query } };
}

export function lensQuery(q: string, field: Field): Record<string, unknown> {
  if (field === "title") return { query: { match: { title: q } } };
  if (field === "author") return { query: { match: { "author.name": q } } };
  return { query: { query_string: { query: q } } };
}
