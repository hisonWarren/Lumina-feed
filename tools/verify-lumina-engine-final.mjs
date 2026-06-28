#!/usr/bin/env node
// 结构级验证 · 引擎终篇 engine_final = engine_tail（ISSN 精确 + seenIds 去重 + PDF 正文 FTS5）+ CJK 友好 FTS（bigram）。
// 自洽叠在 engine_finish。electron/*.ts 用 strip-types --check。⚠ 抽取/FTS/真检索/真 SQLite/中文命中效果全部须真机——本包结构级。
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}
function tsCheck(p){try{execSync(`node --experimental-strip-types --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: strip-types 失败 — ${String(e.stderr||e).split("\n").slice(0,3).join(" ")}`);return false;}}
function jsCheck(p){try{execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: node --check 失败`);return false;}}

console.log("\n— 1. 文件与前置 —");
["src/core/querySpec.ts","electron/ipc.ts","electron/preload.ts","src/ui/lumina-bridge.js","src/ui/modules/Reader.jsx","src/ui/modules/Library.jsx"].forEach((f)=>exists(f)?ok(f.split("/").pop()+" 在"):bad("缺 "+f));
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts"); /runSubscriptionNow/.test(s)?ok("engine_finish 在（前置）"):bad("缺 engine_finish"); /library:list/.test(s)?ok("library_engine 在（前置）"):bad("缺 library_engine"); }

console.log("\n— 2. 语法（TS 剥类型 + JS）/ 平衡 —");
tsCheck("src/core/querySpec.ts")&&ok("querySpec.ts strip-types");
tsCheck("electron/ipc.ts")&&ok("ipc.ts strip-types"); balance("electron/ipc.ts")&&ok("ipc.ts 平衡");
tsCheck("electron/preload.ts")&&ok("preload.ts strip-types");
jsCheck("src/ui/lumina-bridge.js")&&ok("lumina-bridge.js node --check");
balance("src/ui/modules/Reader.jsx")&&ok("Reader.jsx 平衡"); balance("src/ui/modules/Library.jsx")&&ok("Library.jsx 平衡");

console.log("\n— 3. ISSN 精确过滤（querySpec）—");
if(exists("src/core/querySpec.ts")){ const s=read("src/core/querySpec.ts");
  /const isIssn/.test(s)&&/const normIssn/.test(s)?ok("ISSN 识别/归一"):bad("缺 isIssn/normIssn");
  /filters\.push\(`issn:\$\{x\}`\)/.test(s)?ok("Crossref filter=issn:"):bad("Crossref 未加 ISSN");
  /primary_location\.source\.issn:/.test(s)?ok("OpenAlex source.issn"):bad("OpenAlex 未加 ISSN");
  /\? "ISSN" : map\[t\.field\]/.test(s)?ok("EuropePMC ISSN: 字段"):bad("EuropePMC 未用 ISSN");
}
console.log("\n— 4. 订阅 seenIds 去重（ipc）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /const seen = new Set<string>\(Array\.isArray\(sub && sub\.seenIds\)/.test(s)?ok("读取 seenIds"):bad("未读 seenIds");
  /const fresh = agg\.papers\.filter\(\(pp: any\) => !seen\.has\(pp\.id\)\)/.test(s)?ok("只取新增 fresh"):bad("未去重");
  /seenIds: newSeen/.test(s)&&/slice\(-500\)/.test(s)?ok("回写 seenIds（≤500）"):bad("未回写");
  /return \{ ok: true, hits: fresh \}/.test(s)?ok("today/hits=fresh"):bad("未返回 fresh");
}
console.log("\n— 5. PDF 正文 FTS5（抽取→索引→检索）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /CREATE VIRTUAL TABLE IF NOT EXISTS fulltext_fts USING fts5/.test(s)?ok("fulltext_fts（独立，不动 papers_fts）"):bad("缺 fulltext_fts");
  /ipcMain\.handle\("fulltext:save"/.test(s)?ok("fulltext:save（删旧+插新）"):bad("缺 fulltext:save");
  /ipcMain\.handle\("search:local"/.test(s)&&/JOIN library l ON l\.paper_id = f\.paper_id/.test(s)?ok("search:local（MATCH ∩ 工作集）"):bad("缺 search:local 或未限工作集");
}
if(exists("electron/preload.ts")) /fulltextSave:.*invoke\("fulltext:save"/.test(read("electron/preload.ts"))&&/searchLocal:.*invoke\("search:local"/.test(read("electron/preload.ts"))?ok("preload fulltextSave/searchLocal"):bad("preload 未暴露");
if(exists("src/ui/lumina-bridge.js")) /indexFullText/.test(read("src/ui/lumina-bridge.js"))&&/searchLocal/.test(read("src/ui/lumina-bridge.js"))?ok("bridge indexFullText/searchLocal（+ 回退）"):bad("bridge 缺方法");
if(exists("src/ui/modules/Reader.jsx")) /bridge\.indexFullText\(source\.paperId/.test(read("src/ui/modules/Reader.jsx"))&&/ftIndexedRef/.test(read("src/ui/modules/Reader.jsx"))?ok("Reader 抽取后索引（每文档一次 + 打开后台）"):bad("Reader 未索引");
if(exists("src/ui/modules/Library.jsx")){ const s=read("src/ui/modules/Library.jsx");
  /import \{ bridge \}/.test(s)&&/bridge\.searchLocal\(qq\)/.test(s)&&/bodyIds/.test(s)?ok("Library→search:local→bodyIds"):bad("Library 未接正文检索");
  /hay\.includes\(q\) \|\| !!\(bodyIds && bodyIds\.has\(p\.id\)\)/.test(s)?ok("命中=客户端(元数据/总结/批注) 或 引擎正文"):bad("未合并正文命中");
}
console.log("\n— 6. CJK 友好 FTS（bigram；索引/查询一致）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /const ftsPrep = \(text: string\): string =>/.test(s)?ok("ftsPrep 预处理函数"):bad("缺 ftsPrep");
  /0x3400 && c <= 0x9fff/.test(s)?ok("CJK 码段判定（含扩展区/兼容区）"):wn("CJK 码段判定未见");
  /run\[k\] \+ run\[k \+ 1\]/.test(s)?ok("连续 CJK 段→重叠 bigram"):bad("未生成 bigram");
  /\.run\(paperId, ftsPrep\(String\(text\)\.slice\(0, 2000000\)\)\)/.test(s)?ok("入库存 ftsPrep(body)"):bad("入库未用 ftsPrep");
  /const prepped = ftsPrep\(q\)/.test(s)?ok("查询同样 ftsPrep（与索引一致）"):bad("查询未 ftsPrep");
}
console.log("\n— 7. 红线/范围 —");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /渲染层既有 pdfjs 抽取后送来|避免主进程再跑 pdfjs/.test(s)?ok("正文抽取复用渲染层 pdfjs"):wn("未注明抽取来源");
  let leak=false; ["facet(","hitCount","深分页","证据分级"].forEach((b)=>{ if(s.includes(b)){bad(`疑似越界 "${b}"`);leak=true;} });
  if(!leak) ok("正文检索限工作集（非全库）；无分面/命中总数/深分页；只单篇阅读");
}
console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n⚠ 端到端全部须真机（npm run build:electron && npm start）：ISSN 各源真实过滤、seenIds 去重、PDF 正文抽取→FTS5→中文/英文库内检索、真 SQLite/跨进程。沙箱仅结构级（含 strip-types）。\n`));
process.exit(fail?1:0);
