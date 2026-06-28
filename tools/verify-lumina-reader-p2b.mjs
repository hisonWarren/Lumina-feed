#!/usr/bin/env node
// 结构级验证 · patch reader_p2b（前置：p1a + p1b + engine + p2a）
// JSX 计括号 · JS node --check · TS 括号平衡。真实文本选择/划词浮条定位/翻译/解释须真机确认。
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

console.log("\n— 1. 前置（p2a 面板 + p1b 文本层 + engine）—");
if(exists("src/ui/modules/Reader.jsx")){ const s=read("src/ui/modules/Reader.jsx"); /AssistantPanel/.test(s)?ok("p2a 助手面板在"):bad("缺 p2a —— 请先应用 reader_p2a"); }
if(exists("src/ui/pdf-engine.js")){ /renderTextLayer/.test(read("src/ui/pdf-engine.js"))?ok("p1b 文本层在"):bad("缺 p1b 文本层（划词依赖）"); }
if(exists("electron/preload.ts")){ /luminaReader/.test(read("electron/preload.ts"))?ok("engine luminaReader 在"):bad("缺 engine"); }

console.log("\n— 2. 语法/平衡 —");
["src/ui/modules/Reader.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });
["src/ui/lumina-bridge.js"].forEach((f)=>{ if(exists(f)&&nodeCheck(f)) ok(f+" node --check 通过"); });
["electron/ipc.ts","electron/preload.ts","src/core/reader/reader-ai.ts"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡(TS)"); });

console.log("\n— 3. 翻译后端（非接地、无页码）—");
if(exists("src/core/reader/reader-ai.ts")){ const s=read("src/core/reader/reader-ai.ts"); /export async function translateText/.test(s)?ok("reader-ai 导出 translateText"):bad("缺 translateText"); /llm\.complete/.test(s)?ok("经 LlmClient.complete"):wn("未见 complete"); }
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts"); s.includes('"reader:translate"')?ok("注册 reader:translate"):bad("未注册 reader:translate"); s.includes('"reader:summarize"')&&s.includes('"reader:ask"')?ok("既有 reader:summarize/ask 不回归"):bad("既有 reader IPC 丢失"); }
if(exists("electron/preload.ts")){ /translate:/.test(read("electron/preload.ts"))?ok("preload 暴露 luminaReader.translate"):bad("未暴露 translate"); }
if(exists("src/ui/lumina-bridge.js")){ const s=read("src/ui/lumina-bridge.js"); /readerTranslate/.test(s)?ok("bridge.readerTranslate"):bad("缺 readerTranslate"); /mockTranslate/.test(s)?ok("无后端 mock 译文"):wn("缺 mock 译文"); }

console.log("\n— 4. 划词浮条（解释/译/复制）—");
if(exists("src/ui/modules/Reader.jsx")){ const s=read("src/ui/modules/Reader.jsx");
  (/onSelectUp/.test(s)&&/captureTextSelection/.test(s))?ok("选区捕获（captureTextSelection + onSelectUp）"):bad("缺选区捕获");
  /rd-pop/.test(s)?ok("浮条 UI（rd-pop）"):bad("缺浮条 UI");
  /onExplain/.test(s)&&/explainReq/.test(s)?ok("解释 → 推送助手面板（接地+页码，复用 reader:ask）"):bad("缺解释动作");
  /onTranslate/.test(s)&&/readerTranslate/.test(s)?ok("译 → readerTranslate 内联显示"):bad("缺翻译动作");
  /onCopySel/.test(s)&&/clipboard/.test(s)?ok("复制 → 剪贴板"):wn("缺复制");
  /Languages/.test(s)&&/Copy/.test(s)?ok("图标 Languages/Copy"):wn("图标缺");
}

console.log("\n— 5. 范围守护（只单篇 · 不批注写入/编辑/跨文档）—");
let leak=false;
["src/ui/modules/Reader.jsx","src/core/reader/reader-ai.ts"].forEach((f)=>{ if(!exists(f))return; const s=read(f);
  ["pdf-lib","FormField","signature","跨文档","全库","related-papers"].forEach((b)=>{ if(s.includes(b)){ bad(`${f} 含越界项 "${b}"`); leak=true; } });
});
if(!leak) ok("无越界（高亮/便签 留 P3；翻译三模式 留 P2c；只单篇）");

console.log("\n"+(fail?`\x1b[31m✗ 结构级验证未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：真实文本选择、浮条定位、划词翻译/解释（需 LLM）、无 key→mock 须真机确认（见 EXIT_CRITERIA）。\n`));
process.exit(fail?1:0);
