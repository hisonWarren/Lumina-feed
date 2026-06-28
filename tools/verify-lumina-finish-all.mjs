#!/usr/bin/env node
// verify-lumina-finish-all.mjs — structure-level verifier (文档/05 §3).
// Checks: file existence, bracket/backtick balance, contract names, Hook-safe rendering,
// red-line grep, CSS class cross-reference. Does NOT verify visual / end-to-end.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASES = [resolve(HERE,'..','files'), resolve(HERE,'..')];
function find(rel){ for(const b of BASES){ const p=resolve(b,rel); if(existsSync(p)) return p; } return null; }

let pass=0, fail=0; const errs=[];
const ok =()=>{ pass++; };
const bad=(m)=>{ fail++; errs.push(m); };

// strip comments (always) and string/template literals (optional) so brackets inside
// regex/strings/comments don't produce false positives.
function strip(txt, strings=true){
  let s = txt.replace(/\/\*[\s\S]*?\*\//g,' ');          // block comments
  s = s.replace(/(^|[^:])\/\/.*$/gm, (_,p)=>p);          // line comments (keep http://)
  if(strings){
    s = s.replace(/`(?:\\.|[^`\\])*`/g,' BT ');          // template literals
    s = s.replace(/'(?:\\.|[^'\\])*'/g," SQ ");          // single-quoted
    s = s.replace(/"(?:\\.|[^"\\])*"/g,' DQ ');          // double-quoted
  }
  return s;
}

const FILES = [
  'src/core/rank/bm25.ts','src/core/rank/rerank.ts','src/core/search/query-spec.ts','src/core/paper-hygiene.ts','src/core/cite/export.ts','electron/ipc-cite-export.ts',
  'src/ui/components/AbstractSnippet.jsx','src/ui/components/BadgeRow.jsx','src/ui/components/MatchBadge.jsx',
  'src/ui/components/HitSources.jsx','src/ui/components/CitationActions.jsx','src/ui/styles/finish-all.css'
];
const SRC = {};
for(const f of FILES){ const p=find(f); if(!p){ bad(`缺文件: ${f}`); } else { ok(); SRC[f]=readFileSync(p,'utf8'); } }

// per-type count equality — robust against regex/string/template literals (can't lex JS with
// regex); reliably catches truncation / missing braces, which is the failure mode we guard.
function counts(txt){
  const c=(re)=>(txt.match(re)||[]).length;
  return { curly:c(/{/g)===c(/}/g), round:c(/\(/g)===c(/\)/g), square:c(/\[/g)===c(/\]/g) };
}
for(const [f,txt] of Object.entries(SRC)){
  const b=counts(txt);
  if(!(b.curly&&b.round&&b.square)) bad(`括号计数不平衡: ${f} (curly:${b.curly} round:${b.round} square:${b.square})`); else ok();
  if(!f.endsWith('.css')) ((txt.match(/`/g)||[]).length % 2 === 0) ? ok() : bad(`反引号奇数: ${f}`);
}

const must = [
  ['src/core/search/query-spec.ts', /relevance/, '默认 relevance 排序'],
  ['src/core/rank/bm25.ts', /matchKind/, 'matchKind 输出'],
  ['src/core/paper-hygiene.ts', /resolveYear/, '年份校验'],
  ['src/core/cite/export.ts', /toRIS|toBibTeX/, '引用导出'],
  ['electron/ipc-cite-export.ts', /cite:export/, 'IPC cite:export'],
];
for(const [f,re,label] of must){ (SRC[f] && re.test(SRC[f])) ? ok() : bad(`契约缺失(${label}): ${f}`); }

// Hook-safe: no conditional component call `cond && Comp(` in code (comments stripped first)
for(const f of Object.keys(SRC)){
  if(!f.includes('/components/') && !f.includes('/hooks/')) continue;
  /&&\s*[A-Z][A-Za-z0-9]*\s*\(/.test(strip(SRC[f],false)) ? bad(`危险条件组件调用: ${f}`) : ok();
}

const agg = existsSync(resolve(HERE,'..','src/core/aggregate.ts')) ? readFileSync(resolve(HERE,'..','src/core/aggregate.ts'),'utf8') : '';
/rerank/.test(agg) && /normalizePaper/.test(agg) ? ok() : bad('aggregate 缺 rerank/normalizePaper 接线');
/hits\.length|perSource.*count/.test(agg) && !/hitcounttotal/i.test(agg) ? ok() : bad('aggregate 总数语义');

// red-line grep on stripped code (so cautionary comments don't trip it)
const RED = /sci-?hub|libgen|anna'?s\s*archive|\bfacet(s|ed)?\b|\bscreening\b|hitcounttotal/i;
for(const [f,txt] of Object.entries(SRC)){ RED.test(strip(txt,false)) ? bad(`红线命中(盗版/数据库式): ${f}`) : ok(); }

const ff = existsSync(resolve(HERE,'..','src/ui/modules/FindFetch.jsx')) ? readFileSync(resolve(HERE,'..','src/ui/modules/FindFetch.jsx'),'utf8') : '';
/MatchBadge|AbstractSnippet|HitSources/.test(ff) ? ok() : bad('FindFetch 缺 finish_all 组件');
/relevance/.test(ff) ? ok() : bad('FindFetch 缺 relevance 默认排序');
const css = SRC['src/ui/styles/finish-all.css']||'';
for(const cls of ['lf-match','lf-abs','lf-badges','lf-sources','lf-merged','lf-cite-menu','lf-dl','lf-side','lf-collapse','rd-tb','brief-lead']){
  css.includes('.'+cls) ? ok() : bad(`CSS 缺类: .${cls}`);
}

console.log(`\nverify-lumina-finish-all: ${pass} passed, ${fail} failed`);
if(fail){ console.log('—— 失败项 ——'); errs.forEach(e=>console.log('  ✗ '+e)); process.exit(1); }
console.log('✓ 结构级全绿（视觉/端到端见 EXIT_CRITERIA 真机项）');
