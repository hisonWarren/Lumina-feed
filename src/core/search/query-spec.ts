// core/search/query-spec.ts
// Per-source query + sort builders. THE FIX for the relevance bug:
//   * default sort = RELEVANCE for every source (do NOT force date sort by default)
//   * field-scoped queries when field !== 'all' (fixes 按标题搜不到那篇 / pubmed 命中 0)
// Reconcile param names with existing adapters in core/sources/* (文档/04 §3.6).
// Vendor-doc notes:
//   - OpenAlex: `search=` is relevance_score order by default; sort=publication_date:desc OVERRIDES it.
//   - Crossref: relevance score is the default order when a query.* is present.
//   - PubMed esearch: sort=relevance == Best Match (the default we want).
//   - Europe PMC / arXiv: relevance is the default when sort is omitted.

export type Field = 'all'|'title'|'abstract'|'tiab'|'author'|'journal';
export type SortMode = 'relevance'|'recent'|'cited';
export interface YearRange { from?:number; to?:number; }
export interface SourceQuery { params: Record<string,string>; note?:string; }

// ---- OpenAlex (https://api.openalex.org/works) ----
export function openalex(q:string, field:Field, sort:SortMode, yr:YearRange={}): SourceQuery {
  const p:Record<string,string> = {};
  let filter = '';
  if(field==='title')        filter = `title.search:${q}`;
  else if(field==='abstract')filter = `abstract.search:${q}`;
  else if(field==='author')  filter = `raw_author_name.search:${q}`;
  else if(field==='journal') filter = `primary_location.source.display_name.search:${q}`;
  else p['search'] = q;                                  // all / tiab → relevance over title+abstract+fulltext
  if(yr.from) filter = (filter?filter+',':'') + `from_publication_date:${yr.from}-01-01`;
  if(yr.to)   filter = (filter?filter+',':'') + `to_publication_date:${yr.to}-12-31`;
  if(filter) p['filter'] = filter;
  if(sort==='recent')      p['sort'] = 'publication_date:desc,relevance_score:desc';
  else if(sort==='cited')  p['sort'] = 'cited_by_count:desc';
  // relevance: OMIT sort → native relevance_score order
  return { params:p };
}

// ---- Crossref (https://api.crossref.org/works) ----
export function crossref(q:string, field:Field, sort:SortMode, yr:YearRange={}): SourceQuery {
  const p:Record<string,string> = {};
  if(field==='title')        p['query.title']=q;
  else if(field==='author')  p['query.author']=q;
  else if(field==='journal') p['query.container-title']=q;
  else p['query.bibliographic']=q;                       // best general relevance
  const f:string[]=[];
  if(yr.from) f.push(`from-pub-date:${yr.from}-01-01`);
  if(yr.to)   f.push(`until-pub-date:${yr.to}-12-31`);
  if(f.length) p['filter']=f.join(',');
  if(sort==='recent'){ p['sort']='published'; p['order']='desc'; }
  else if(sort==='cited'){ p['sort']='is-referenced-by-count'; p['order']='desc'; }
  // relevance: omit sort → Crossref default relevance score
  return { params:p };
}

// ---- PubMed E-utilities esearch ----
export function pubmed(q:string, field:Field, sort:SortMode, yr:YearRange={}): SourceQuery {
  let term = q;
  if(field==='title')        term = `${q}[Title]`;
  else if(field==='tiab' || field==='abstract') term = `${q}[Title/Abstract]`;
  else if(field==='author')  term = `${q}[Author]`;
  else if(field==='journal') term = `${q}[Journal]`;
  if(yr.from||yr.to) term = `(${term}) AND (${yr.from||1800}:${yr.to||3000}[pdat])`;
  const p:Record<string,string> = { db:'pubmed', term, retmode:'json' };
  p['sort'] = sort==='recent' ? 'date' : 'relevance';    // Best Match by default
  return { params:p };
}

// ---- Europe PMC ----
export function europepmc(q:string, field:Field, sort:SortMode, yr:YearRange={}): SourceQuery {
  let query = q;
  if(field==='title')        query = `TITLE:"${q}"`;
  else if(field==='abstract')query = `ABSTRACT:"${q}"`;
  else if(field==='tiab')    query = `(TITLE:"${q}" OR ABSTRACT:"${q}")`;
  else if(field==='author')  query = `AUTH:"${q}"`;
  else if(field==='journal') query = `JOURNAL:"${q}"`;
  if(yr.from||yr.to) query = `(${query}) AND (PUB_YEAR:[${yr.from||1800} TO ${yr.to||3000}])`;
  const p:Record<string,string> = { query, format:'json', resultType:'core' };
  if(sort==='recent') p['sort']='P_PDATE_D desc';
  else if(sort==='cited') p['sort']='CITED desc';
  return { params:p };
}

// ---- arXiv ----
export function arxiv(q:string, field:Field, sort:SortMode): SourceQuery {
  const prefix = field==='title'?'ti:':field==='author'?'au:':field==='abstract'?'abs:':'all:';
  const p:Record<string,string> = { search_query:`${prefix}${q}` };
  p['sortBy']    = sort==='recent' ? 'submittedDate' : 'relevance';
  p['sortOrder'] = 'descending';
  return { params:p };
}

// bioRxiv/medRxiv: no native relevance search API; typically reached via Crossref/EuropePMC mirror.
export const SOURCE_BUILDERS = { openalex, crossref, pubmed, europepmc, arxiv };
