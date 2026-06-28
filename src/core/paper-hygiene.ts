// lumina-feed · 数据清洗（ingest 前）：年份校验、实体解码、文本清洗
//   * year validation (stops the 2017→2107 garbage from ever reaching the UI)
//   * HTML-entity decode (fixes "Toxicology &amp; Pest Control")
//   * text / author cleanup (strip stray tags, collapse whitespace, handle RTL names)

const NAMED:Record<string,string> = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', ndash:'–', mdash:'—' };
export function decodeEntities(s?:string):string {
  if(!s) return '';
  let prev='', out=String(s);
  for(let i=0;i<2 && out!==prev;i++){ prev=out;            // run twice → catch double-encoding (&amp;amp;)
    out = out.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi,(m,e)=>{
      if(e[0]==='#'){
        const code = e[1] && e[1].toLowerCase()==='x' ? parseInt(e.slice(2),16) : parseInt(e.slice(1),10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  return out;
}
export function cleanText(s?:string):string {
  return decodeEntities(s).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
}

const NOW = ()=> new Date().getFullYear();
function fourDigit(s?:string):number|undefined {
  const m = String(s||'').match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/g);
  if(!m) return undefined;
  for(const y of m){ const n=+y; if(n>=1500 && n<=NOW()+1) return n; }
  return undefined;
}
// Robust year: prefer a valid `year`, else parse pubDate, else 4-digit from date/DOI strings.
// NEVER emit an implausible year. (The 2107 root cause should also be fixed upstream; this stops the leak.)
export function resolveYear(p:any):number|undefined {
  const y = Number(p.year);
  if(Number.isInteger(y) && y>=1500 && y<=NOW()+1) return y;
  return fourDigit(p.pubDate) ?? fourDigit(p.year!=null?String(p.year):'') ?? fourDigit(p.doi);
}

function nameStr(a:any):string {
  if(typeof a==='string') return a;
  if(!a) return '';
  return a.name || [a.given, a.family].filter(Boolean).join(' ') || '';
}
export function normalizeAuthors(authors:any[]):string[] {
  return (authors||[]).map(nameStr).map(s=>cleanText(s)).filter(Boolean);
}

// One call to normalize a Paper before it enters the UI / ranker.
export function normalizePaper(p:any):any {
  return { ...p,
    title:         cleanText(p.title),
    abstract:      cleanText(p.abstract),
    journal:       cleanText(p.journal),
    journalAbbrev: cleanText(p.journalAbbrev),
    authors:       normalizeAuthors(p.authors),
    year:          resolveYear(p) ?? p.year
  };
}
