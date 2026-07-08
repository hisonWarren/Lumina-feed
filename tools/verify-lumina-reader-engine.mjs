#!/usr/bin/env node
// 结构级验证 · patch reader_engine（后端 TS：括号平衡 + 契约 grep）
// 说明：TS 含类型语法，无法 node --check；esbuild 构建仅去类型不做类型检查 →
//      代码须"运行时正确"(已对照真实引擎签名编写)；TS 类型健全性 + 真实 LLM/PDF/IPC 行为须真机确认。
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let fail = 0, warn = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { console.log("  \x1b[31m✗ " + m + "\x1b[0m"); fail++; };
const wn = (m) => { console.log("  \x1b[33m! " + m + "\x1b[0m"); warn++; };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
function strip(s){ return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," "); }
function balance(p){ const s=strip(read(p)); for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1; if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}} return true; }

console.log("\n— 1. 前置（v0.3.0-minimal 引擎）在位 —");
["electron/ipc.ts","electron/preload.ts","src/core/summarize/llm-client.ts","src/core/trust/grounded-summary.ts","src/core/oa/pdf-fetch.ts","electron/settings.ts","src/core/store/index.ts"].forEach((f)=> exists(f)?ok(f):bad("缺前置 "+f));

console.log("\n— 2. 本补丁文件 + 括号平衡（TS）—");
["src/core/reader/reader-ai.ts"].forEach((f)=> exists(f)?ok("新增 "+f):bad("缺 "+f));
["electron/ipc.ts","electron/preload.ts","src/core/reader/reader-ai.ts"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });

console.log("\n— 3. IPC 注册（新 + 既有不回归）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  [["oa:fetchPdf",1],["oa:readPdf",1],["oa:listPdfs",1],["reader:summarize",1],["reader:ask",1]].forEach(([h])=>{ s.includes(`"${h}"`)?ok("注册 "+h):bad("未注册 "+h); });
  ["search:online","summarize:paper","oa:resolve","settings:get","settings:save","secrets:set"].forEach((h)=>{ s.includes(`"${h}"`)?ok("既有 "+h+" 仍在"):bad("丢失既有 "+h); });
}

console.log("\n— 4. 红线 / 契约 —");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /allowAltSources:\s*true/.test(s)?ok("oa:fetchPdf 启用多源取文（allowAltSources:true）"):bad("未启用多源取文");
  /oa:fetchPaper/.test(s)?ok("注册 oa:fetchPaper 统一候选链"):bad("未注册 oa:fetchPaper");
  /fetchPaperPdf/.test(s)?ok("接入 fetchPaperPdf"):bad("未接入 fetchPaperPdf");
  exists("src/core/oa/alt-sources.ts")&&exists("src/core/oa/config/alt-mirrors.json")?ok("备选渠道 alt-sources + 镜像配置在位"):bad("缺 alt-sources 或 alt-mirrors.json");
  (/Sci-?Hub/i.test(s)||/libgen/i.test(s))?wn("ipc 注释含渠道名（预期）"):ok("ipc 无渠道字样");
}

console.log("\n— 5. preload 暴露 —");
if(exists("electron/preload.ts")){ const s=read("electron/preload.ts");
  /luminaReader/.test(s)?ok("暴露 window.luminaReader"):bad("未暴露 luminaReader");
  /readPdf/.test(s)&&/listPdfs/.test(s)?ok("暴露 oa.readPdf + listPdfs"):bad("未暴露 readPdf/listPdfs");
  /reader:summarize/.test(s)&&/reader:ask/.test(s)?ok("luminaReader → reader:summarize / reader:ask"):bad("reader 通道不全");
}

console.log("\n— 6. 阅读器接地 AI 契约（红线 2/4：只单篇 · sourceBasis · 页码引用 · 不替判定）—");
if(exists("src/core/reader/reader-ai.ts")){ const s=read("src/core/reader/reader-ai.ts");
  /export async function summarizeReader/.test(s)&&/export async function askReader/.test(s)?ok("导出 summarizeReader + askReader"):bad("接地 AI 导出不全");
  /buildAskMemoryBlock/.test(s)&&/ASK_PRIOR_TURN_CAP/.test(s)?ok("问答 L1+L2 记忆块"):bad("缺问答记忆");
  /sourceBasis:\s*"fulltext"/.test(s)?ok("回答带 sourceBasis:fulltext"):bad("缺 sourceBasis");
  /groundReaderAnswer/.test(s)?ok("阅读器专用页锚接地 groundReaderAnswer（按 claim 在引用页核验·接地比例/横幅）"):bad("未接地");
  /extractCitations/.test(s)&&/\[p\\?\.\(/.test(s)?ok("抽取页码引用 [p.X]（红线4）"):wn("页码引用抽取需核对");
  /llm\.complete\(/.test(s)?ok("经 LlmClient.complete 调用模型"):bad("未用 LlmClient.complete");
  /selectPages/.test(s)?ok("页锚 RAG（按页选取）"):wn("未见页锚选取");
  (/cross.?doc/i.test(s)||/全库|跨文档/.test(s))?bad("出现跨文档字样（应只单篇）"):ok("仅单篇（无跨文档）");
}

console.log("\n"+(fail?`\x1b[31m✗ 结构级验证未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：TS 类型健全性须 esbuild/真机构建；真实 OA 取文/落盘读回、真实 LLM 接地总结与带页码问答须真机确认（见 EXIT_CRITERIA）。\n`));
process.exit(fail?1:0);
