#!/usr/bin/env node
// 结构级验证 · patch library（前置：settings；纯渲染层）。FTS5 全文检索属引擎层（未含）。
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}
function jsxSyntaxCheck(p){try{execSync(`node tools/jsx-syntax-check.mjs ${p}`,{stdio:"pipe",cwd:process.cwd()});return true;}catch{return false;}}
function nodeCheck(p){try{execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: node --check 失败 — ${String(e.stderr||e).split("\n")[0]}`);return false;}}

console.log("\n— 1. 文件与前置（settings 已应用）—");
exists("src/ui/cite.js")?ok("cite.js 新增"):bad("缺 cite.js");
exists("src/ui/modules/Library.jsx")?ok("Library.jsx 新增"):bad("缺 Library.jsx");
if(exists("src/ui/LuminaApp.jsx")){ /import Settings from/.test(read("src/ui/LuminaApp.jsx"))?ok("settings 在（壳含 Settings）"):bad("缺 settings —— 请先应用 settings"); }

console.log("\n— 2. 语法/平衡 —");
["src/ui/modules/Library.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });
jsxSyntaxCheck("src/ui/LuminaApp.jsx")&&ok("LuminaApp.jsx 语法（jsx-syntax-check）");
if(exists("src/ui/cite.js")&&nodeCheck("src/ui/cite.js")) ok("cite.js node --check 通过");

console.log("\n— 3. 引用引擎（CSL 中介 + 五样式 + 导出）—");
if(exists("src/ui/cite.js")){ const s=read("src/ui/cite.js");
  /export function toCSL/.test(s)?ok("toCSL（CSL-JSON 中介）"):bad("缺 toCSL");
  /formatAPA/.test(s)&&/formatMLA/.test(s)&&/formatChicago/.test(s)&&/formatVancouver/.test(s)&&/formatBibTeX/.test(s)?ok("五样式 APA/MLA/Chicago/Vancouver/BibTeX"):bad("样式不全");
  /export function exportBib/.test(s)&&/export function exportRis/.test(s)&&/export function exportCslJson/.test(s)?ok(".bib/.ris/CSL-JSON 导出"):bad("导出不全");
}

console.log("\n— 4. 我的文献（搜索/筛选/排序/分组/引用/导出/移除）—");
if(exists("src/ui/modules/Library.jsx")){ const s=read("src/ui/modules/Library.jsx");
  /value={query}/.test(s)?ok("客户端搜索框"):bad("缺搜索");
  /fFulltext/.test(s)&&/fPreprint/.test(s)&&/fOa/.test(s)?ok("筛选 chip（有全文/预印本/OA）"):bad("筛选不全");
  /sort === "year"|sort === "title"|recent/.test(s)?ok("排序（最近/年份/标题）"):wn("排序未全");
  /grouped/.test(s)&&/provenance/.test(s)?ok("按来源分组（provenance）"):bad("缺来源分组");
  /STYLES\.map/.test(s)&&/formatCitation/.test(s)?ok("每卡多样式引用复制"):bad("缺引用复制");
  /exportBib|doExport/.test(s)?ok("导出菜单（.bib/.ris/CSL）"):bad("缺导出菜单");
  /exportPickMode/.test(s)&&/exportSel/.test(s)?ok("独立选择导出模式"):bad("缺选择导出");
  /onRemove/.test(s)?ok("移除"):bad("缺移除");
  /未经同行评议/.test(s)?ok("预印本标注（红线5）"):bad("缺预印本标注");
  /已撤稿|retracted/.test(s)?ok("撤稿标注（红线6）"):bad("缺撤稿标注");
  /LIB_PREFS_KEY/.test(s)&&/patchJsonPref/.test(s)?ok("文献库 UI 偏好 localStorage 持久化"):bad("缺文献库偏好持久化");
  /corpusCacheKey/.test(s)&&/readerAnalysisSave/.test(s)?ok("跨篇分析结果缓存"):bad("缺跨篇分析缓存");
}

console.log("\n— 5. 壳接线 —");
if(exists("src/ui/LuminaApp.jsx")){ const s=read("src/ui/LuminaApp.jsx");
  /import Library from/.test(s)?ok("引入 Library"):bad("未引入 Library");
  (/view === "library"/.test(s) || /mode === "library"/.test(s))?ok("渲染 Library（library 视图）"):bad("未渲染 Library");
  /我的文献/.test(s)?ok("我的文献 tab"):bad("缺 tab");
  /lib={lib}/.test(s)?ok("传入工作集 lib"):bad("未传 lib");
}

console.log("\n— 6. 范围守护（非参考文献管理器）—");
let leak=false; const s=exists("src/ui/modules/Library.jsx")?read("src/ui/modules/Library.jsx"):"";
["嵌套文件夹","标签分类","云同步","群组","边写边引","9000"].forEach((b)=>{ if(s.includes(b)){bad(`含越界项 "${b}"`);leak=true;} });
if(!leak) ok("无越界（单层工作集 + 导出友好；无嵌套文件夹/标签/云同步；FTS5 留引擎层）");

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：客户端搜索/筛选/排序/分组、五样式引用文本与 .bib/.ris/CSL 正确性、导出文件落地须真机确认；PDF 全文+总结+批注的 FTS5 检索属引擎层（需 electron/）。\n`));
process.exit(fail?1:0);
