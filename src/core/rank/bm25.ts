// core/rank/bm25.ts
// Self-contained BM25 re-ranker over a candidate Paper[] (the merged multi-source pool).
// Built against the documented Paper contract (文档/04 §3.1). No external deps.
// WHY: each source returns its own relevance order; once merged we need ONE unified score.
// This is NOT database-ification — it powers "find THAT paper" (定位), the product's core promise.

export type MatchKind = 'title_exact' | 'title_strong' | 'normal';
export interface RankedHit<T> { item: T; score: number; matchKind: MatchKind; }
export interface ParsedQuery {
  raw: string;
  terms: string[];
  phrases: string[];
  field: 'all'|'title'|'abstract'|'tiab'|'author'|'journal';
}

const STOP = new Set(('a an the of and or not to in on for with by from as at is are be this that '
  + 'we our using study based results show between among into within across '
  + '的 了 和 与 在 是 对 及 以 为 之').split(/\s+/));
const BOOL = new Set(['and','or','not']);

function stripDiacritics(s:string){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

export function tokenize(text:string): string[] {
  if(!text) return [];
  const t = stripDiacritics(String(text).toLowerCase());
  const out:string[] = [];
  const re = /[a-z0-9]+|[\u4e00-\u9fff]+/g;
  let m:RegExpExecArray|null;
  while((m = re.exec(t))){
    const tok = m[0];
    if(/[\u4e00-\u9fff]/.test(tok)){
      if(tok.length === 1) out.push(tok);
      else for(let i=0;i<tok.length-1;i++) out.push(tok.slice(i,i+2));
    } else if(tok.length>1 && !STOP.has(tok) && !BOOL.has(tok)){
      out.push(tok);
    }
  }
  return out;
}

export function parseQuery(raw:string, field:ParsedQuery['field']='all'): ParsedQuery {
  const phrases:string[] = [];
  const noPhrase = String(raw||'').replace(/"([^"]+)"/g, (_,p)=>{ phrases.push(stripDiacritics(p.toLowerCase()).trim()); return ' '; });
  return { raw, phrases, terms: tokenize(noPhrase), field };
}

function normTitle(s:string){ return stripDiacritics(String(s||'').toLowerCase()).replace(/[^a-z0-9\u4e00-\u9fff]+/g,' ').trim(); }

interface FieldText { title:string; abstract:string; meta:string; }
function fieldsOf(p:any): FieldText {
  return {
    title: p.title || '',
    abstract: p.abstract || '',
    meta: [ (p.authors||[]).map((a:any)=>typeof a==='string'?a:(a&&a.name)||'').join(' '),
            p.journal||'', p.journalAbbrev||'', (p.keywords||[]).join(' ') ].join(' ')
  };
}

const FIELD_WEIGHT: Record<'title'|'abstract'|'meta',number> = { title: 3.0, abstract: 1.0, meta: 0.45 };
const K1 = 1.4, B = 0.72;

function recencyBoost(year:number, now:number, weight:number){
  if(!year || year<1500 || year>now+1) return 1;
  const age = Math.max(0, now - year);
  return 1 + weight * Math.exp(-age/12);
}

export interface Bm25Opts { recencyWeight?:number; now?:number; }

export function bm25Rank<T extends object>(items:T[], pq:ParsedQuery, opts:Bm25Opts={}): RankedHit<T>[] {
  const now = opts.now ?? new Date().getFullYear();
  const recW = opts.recencyWeight ?? 0.12;
  const N = items.length || 1;

  const docTokens = items.map(p=>{
    const f = fieldsOf(p);
    return { title: tokenize(f.title), abstract: tokenize(f.abstract), meta: tokenize(f.meta) };
  });

  const allTerms = new Set(pq.terms);
  const df:Record<string,number> = {};
  allTerms.forEach(term=>{
    let c=0; docTokens.forEach(d=>{ if(d.title.includes(term)||d.abstract.includes(term)||d.meta.includes(term)) c++; });
    df[term]=c;
  });
  const idf:Record<string,number> = {};
  allTerms.forEach(t=>{ idf[t] = Math.log(1 + (N - df[t] + 0.5)/(df[t] + 0.5)); });

  const avg = { title:0, abstract:0, meta:0 };
  docTokens.forEach(d=>{ avg.title+=d.title.length; avg.abstract+=d.abstract.length; avg.meta+=d.meta.length; });
  (['title','abstract','meta'] as const).forEach(f=> { avg[f] = (avg[f]/N)||1; });

  const queryPhrase = normTitle(pq.raw.replace(/\b(and|or|not)\b/gi,' '));

  return items.map((item,i)=>{
    const d = docTokens[i];
    const f = fieldsOf(item as any);
    let score = 0;
    (['title','abstract','meta'] as const).forEach(field=>{
      const toks = d[field]; const len = toks.length||1; const w = FIELD_WEIGHT[field];
      const tf:Record<string,number> = {}; toks.forEach(t=> { tf[t]=(tf[t]||0)+1; });
      pq.terms.forEach(term=>{
        const freq = tf[term]; if(!freq) return;
        const denom = freq + K1*(1 - B + B*(len/avg[field]));
        score += w * idf[term] * (freq*(K1+1))/denom;
      });
    });

    const nt = normTitle(f.title);
    let matchKind:MatchKind = 'normal';
    if(queryPhrase && nt && (nt===queryPhrase || nt.includes(queryPhrase))){ score += 14; matchKind='title_exact'; }
    else {
      const titleToks = new Set(d.title);
      const cover = pq.terms.length ? pq.terms.filter(t=>titleToks.has(t)).length / pq.terms.length : 0;
      if(cover>=0.85 && pq.terms.length>=2){ score += 6; matchKind='title_strong'; }
      else if(cover>=0.6){ score += 2; }
    }
    pq.phrases.forEach(ph=>{ const np=normTitle(ph);
      if(np && nt.includes(np)) score+=4;
      if(np && normTitle(f.abstract).includes(np)) score+=1.5; });

    score *= recencyBoost((item as any).year, now, recW);
    return { item, score, matchKind };
  }).sort((a,b)=> b.score - a.score);
}
