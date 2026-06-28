// core/rank/rerank.ts
// Unify multi-source candidates into ONE ranked list. Default = relevance (定位).
// Sort modes: 'relevance' (default), 'recent', 'cited'. Recency/citation are OPT-IN, not default.
import { bm25Rank, parseQuery, type RankedHit, type ParsedQuery } from "./bm25.ts";

export type SortMode = 'relevance'|'recent'|'cited';
export interface RerankOpts { sort?:SortMode; field?:ParsedQuery['field']; now?:number; }

function yearOf(p:any){ const y=Number(p.year); const max=(new Date().getFullYear())+1; return (y>=1500 && y<=max)? y : 0; }

export function rerank<T extends object>(papers:T[], rawQuery:string, opts:RerankOpts={}): RankedHit<T>[] {
  const sort = opts.sort ?? 'relevance';
  const pq = parseQuery(rawQuery, opts.field ?? 'all');
  const scored = bm25Rank(papers, pq, { now: opts.now });
  if(sort==='relevance') return scored;
  const arr = [...scored];
  if(sort==='recent'){
    arr.sort((a,b)=>{ const dy = yearOf(b.item) - yearOf(a.item); return dy || (b.score - a.score); });
  } else if(sort==='cited'){
    arr.sort((a,b)=>{ const dc = (Number((b.item as any).citationCount)||0) - (Number((a.item as any).citationCount)||0); return dc || (b.score - a.score); });
  }
  return arr;
}
