#!/usr/bin/env node
// 结构级验证 · patch reader_p2a（前置：reader_p1a + reader_p1b + reader_engine）
// JSX 计括号 · JS node --check。真实 LLM 接地总结/带页码问答、文本选择、已下载读回须真机确认。
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
let fail = 0, warn = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { console.log("  \x1b[31m✗ " + m + "\x1b[0m"); fail++; };
const wn = (m) => { console.log("  \x1b[33m! " + m + "\x1b[0m"); warn++; };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
function strip(s){ return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," "); }
function balance(p){ const s=strip(read(p)); for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1; if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}} return true; }
function nodeCheck(p){ try{ execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"}); return true; }catch(e){ bad(`${p}: node --check 失败 — ${String(e.stderr||e).split("\n")[0]}`); return false; } }

console.log("\n— 1. 前置（p1b 文本层 + engine 后端 + 基线）—");
if(exists("src/ui/pdf-engine.js")){ const s=read("src/ui/pdf-engine.js"); /renderTextLayer/.test(s)&&/getPageStrings/.test(s)?ok("p1b 文本层在（renderTextLayer+getPageStrings）"):bad("缺 p1b —— 请先应用 reader_p1b"); }
else bad("缺 src/ui/pdf-engine.js");
if(exists("electron/preload.ts")){ /luminaReader/.test(read("electron/preload.ts"))?ok("engine 在（preload 暴露 luminaReader）"):bad("缺 engine —— 请先应用 reader_engine"); }
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts"); /"reader:summarize"/.test(s)&&/"reader:ask"/.test(s)?ok("engine reader IPC 在"):bad("缺 reader:summarize/ask"); /"oa:listPdfs"/.test(s)&&/"oa:readPdf"/.test(s)?ok("engine oa 读回在"):bad("缺 oa:readPdf/listPdfs"); }
["src/ui/modules/Reader.jsx","src/ui/modules/ReadHub.jsx","src/ui/lumina-bridge.js","src/ui/modules/FindFetch.jsx"].forEach((f)=> exists(f)?ok(f):bad("缺 "+f));

console.log("\n— 2. 语法/平衡 —");
["src/ui/modules/Reader.jsx","src/ui/modules/ReadHub.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });
["src/ui/pdf-engine.js","src/ui/lumina-bridge.js"].forEach((f)=>{ if(exists(f)&&nodeCheck(f)) ok(f+" node --check 通过"); });

console.log("\n— 3. pdf-engine 取文/引用工具 —");
if(exists("src/ui/pdf-engine.js")){ const s=read("src/ui/pdf-engine.js");
  /export async function getDocPages/.test(s)?ok("getDocPages（逐页文本供 AI）"):bad("缺 getDocPages");
  /export function splitCites/.test(s)?ok("splitCites（拆 [p.X] 可点击；正则集中在 .js）"):bad("缺 splitCites");
}

console.log("\n— 4. bridge 接 reader_engine（含 mock 回退）—");
if(exists("src/ui/lumina-bridge.js")){ const s=read("src/ui/lumina-bridge.js");
  /readerSummarize/.test(s)&&/readerAsk/.test(s)?ok("readerSummarize + readerAsk"):bad("缺 reader 桥方法");
  /listDownloaded/.test(s)&&/readPdf/.test(s)?ok("listDownloaded + readPdf（已下载读回）"):bad("缺已下载读回桥");
  /luminaReader/.test(s)?ok("R() = window.luminaReader"):bad("未取 luminaReader");
  /mockReader/.test(s)?ok("无后端/无 key mock 回退"):wn("未见 mock 回退");
}

console.log("\n— 5. 阅读助手面板（红线4：可点击页码 + sourceBasis）—");
if(exists("src/ui/modules/Reader.jsx")){ const s=read("src/ui/modules/Reader.jsx");
  /function AssistantPanel/.test(s)?ok("AssistantPanel 面板"):bad("缺 AssistantPanel");
  /bridge\.readerSummarize/.test(s)&&/bridge\.readerAsk/.test(s)?ok("整篇总结 + 接地问答接 bridge"):bad("未接 reader 桥");
  /function CiteText/.test(s)&&/splitCites/.test(s)?ok("CiteText 渲染 [p.X]"):bad("缺引用渲染");
  /lf-cite/.test(s)&&/onGoto\(/.test(s)?ok("页码引用可点击跳页（红线4）"):bad("页码引用不可点击");
  /基于全文|基于摘要|rd-basis/.test(s)?ok("回答标 sourceBasis 徽章（红线4）"):bad("缺 sourceBasis 展示");
  /aiOpen/.test(s)&&/Sparkles/.test(s)?ok("工具栏「助手」开关"):wn("未见助手开关");
  /groundedRatio|接地/.test(s)?ok("展示接地比例/横幅"):wn("未展示接地比例");
}

console.log("\n— 6. ReadHub 已下载全文接线 —");
if(exists("src/ui/modules/ReadHub.jsx")){ const s=read("src/ui/modules/ReadHub.jsx");
  /listDownloaded/.test(s)?ok("ReadHub 拉取已下载列表"):bad("未拉取已下载");
  /onOpenDownloaded/.test(s)&&/readPdf/.test(s)?ok("点开已下载 → readPdf → 阅读"):bad("未接已下载开读");
}

console.log("\n— 7. 范围守护（只单篇 · 不编辑/批注/跨文档/写作）—");
let leak=false;
["src/ui/modules/Reader.jsx","src/ui/modules/ReadHub.jsx"].forEach((f)=>{ if(!exists(f))return; const s=read(f);
  ["pdf-lib","FormField","signature","跨文档","全库","related-papers","代写"].forEach((b)=>{ if(s.includes(b)){ bad(`${f} 含越界项 "${b}"`); leak=true; } });
});
if(!leak) ok("无越界（划词浮条/批注/翻译三模式 留 P2b/P3；只单篇）");

console.log("\n"+(fail?`\x1b[31m✗ 结构级验证未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：真实 LLM 接地总结/带页码问答的质量与引用、文本选择、已下载读回开读、无 key→mock 路径须真机确认（见 EXIT_CRITERIA）。\n`));
process.exit(fail?1:0);
