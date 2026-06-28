// core/cite/export.ts
// CSL-JSON → .ris / .bib generation. The download-file path the user asked for
// (引用直接下载，导入文献管理器). Batch export stays in 我的文献; this adds per-result
// + selection download on the results page. 文档/04 §4.

export interface CiteInput {
  title?:string; authors?:any[]; journal?:string; journalAbbrev?:string;
  year?:number|string; volume?:string; issue?:string; pages?:string;
  doi?:string; pmid?:string; url?:string; abstract?:string; isPreprint?:boolean;
}
function authParts(a:any){
  if(typeof a==='string'){ const parts=a.trim().split(/\s+/); return { family:parts.slice(-1)[0]||a, given:parts.slice(0,-1).join(' ') }; }
  return { family:(a&&(a.family||a.name))||'', given:(a&&a.given)||'' };
}
function yr4(y:any){ return String(y||'').slice(0,4); }

export function toCSL(p:CiteInput){
  return {
    type: p.isPreprint?'article':'article-journal',
    title:p.title,
    author:(p.authors||[]).map(authParts).map(x=>({ family:x.family, given:x.given })),
    'container-title':p.journal,
    issued:{ 'date-parts':[[Number(yr4(p.year))||0]] },
    volume:p.volume, issue:p.issue, page:p.pages, DOI:p.doi, PMID:p.pmid, URL:p.url
  };
}

const esc = (s:any)=> String(s||'').replace(/[{}]/g,'');
export function toBibTeX(p:CiteInput):string {
  const year = yr4(p.year);
  const first = (p.authors && p.authors[0]) ? authParts(p.authors[0]).family : 'ref';
  const key = (first+year).replace(/[^A-Za-z0-9]/g,'') || 'ref';
  const authors = (p.authors||[]).map(a=>{ const x=authParts(a); return [x.family,x.given].filter(Boolean).join(', '); }).join(' and ');
  const L:string[] = [`@${p.isPreprint?'misc':'article'}{${key},`];
  const f=(k:string,v?:string)=>{ if(v) L.push(`  ${k.padEnd(9)}= {${esc(v)}},`); };
  f('title',p.title); f('author',authors); f('journal',p.journal); f('year',year);
  f('volume',p.volume); f('number',p.issue); f('pages',p.pages); f('doi',p.doi);
  if(p.url) f('url',p.url);
  L[L.length-1] = L[L.length-1].replace(/,$/,'');
  L.push('}');
  return L.join('\n') + '\n';
}
export function toRIS(p:CiteInput):string {
  const L:string[] = [`TY  - ${p.isPreprint?'GEN':'JOUR'}`];
  (p.authors||[]).forEach(a=>{ const x=authParts(a); L.push(`AU  - ${[x.family,x.given].filter(Boolean).join(', ')}`); });
  const add=(t:string,v?:string)=>{ if(v) L.push(`${t}  - ${v}`); };
  add('TI',p.title); add('JO',p.journal); add('JA',p.journalAbbrev);
  add('PY',yr4(p.year)); add('VL',p.volume); add('IS',p.issue); add('SP',p.pages);
  add('DO',p.doi); if(p.pmid) L.push(`AN  - ${p.pmid}`); add('UR',p.url); add('AB',p.abstract);
  L.push('ER  - ', '');
  return L.join('\r\n');
}

export type CiteFormat='ris'|'bib';
export function citeFile(p:CiteInput, fmt:CiteFormat){
  const first = (p.authors && p.authors[0]) ? authParts(p.authors[0]).family : 'reference';
  const base = (first+'_'+yr4(p.year)).replace(/[^A-Za-z0-9_]/g,'') || 'reference';
  return {
    name:`${base}.${fmt}`,
    mime: fmt==='ris'?'application/x-research-info-systems':'application/x-bibtex',
    text: fmt==='ris'?toRIS(p):toBibTeX(p)
  };
}
export function citeFileBatch(items:CiteInput[], fmt:CiteFormat){
  const text = items.map(p=> fmt==='ris'?toRIS(p):toBibTeX(p)).join(fmt==='ris'?'\r\n':'\n');
  return {
    name:`lumina_export_${items.length}.${fmt}`,
    mime: fmt==='ris'?'application/x-research-info-systems':'application/x-bibtex',
    text
  };
}
