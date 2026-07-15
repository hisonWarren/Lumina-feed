#!/usr/bin/env node
// 结构级验证 · patch reader_p3（前置：全链至 reader_p2c）。
// JSX 计括号 · JS node --check · TS 括号平衡。高亮坐标对齐/pdf-lib 导出/截取/持久化往返须真机确认。
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

console.log("\n— 1. 前置（全链至 p2c）—");
if(exists("src/ui/modules/Reader.jsx")){ const s=read("src/ui/modules/Reader.jsx"); /TranslatePanel/.test(s)?ok("p2c 翻译面板在"):bad("缺 p2c —— 请先应用 reader_p2c"); /AssistantPanel/.test(s)&&/rd-pop/.test(s)?ok("p2a 面板 + p2b 浮条在"):bad("缺 p2a/p2b"); }
if(exists("src/ui/lumina-bridge.js")){ /readerTranslate/.test(read("src/ui/lumina-bridge.js"))?ok("bridge.readerTranslate 在（p2b）"):bad("缺 p2b 桥"); }
if(exists("src/ui/pdf-engine.js")){ /getPageStrings/.test(read("src/ui/pdf-engine.js"))?ok("getPageStrings 在（p1b）"):bad("缺 p1b"); }

console.log("\n— 2. 语法/平衡 —");
["src/ui/modules/Reader.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡（大注入后）"); });
["src/ui/pdf-export.js","src/ui/lumina-bridge.js"].forEach((f)=>{ if(exists(f)&&nodeCheck(f)) ok(f+" node --check 通过"); });
["electron/ipc.ts","electron/preload.ts"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡(TS)"); });

console.log("\n— 3. 批注引擎（侧车 SQLite · 本地优先红线7）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  s.includes('"annotations:get"')&&s.includes('"annotations:save"')&&s.includes('"annotations:getMerged"')?ok("注册 annotations:get/save/getMerged"):bad("缺 annotations IPC");
  /sources_cache/.test(s)&&/anno:/.test(s)?ok("以 anno:<docKey> 存 SQLite"):wn("未见 SQLite 持久化");
  s.includes('"reader:translate"')&&s.includes('"reader:summarize"')?ok("既有 reader IPC 不回归"):bad("既有 reader IPC 丢失");
}
if(exists("electron/preload.ts")){ /luminaAnno/.test(read("electron/preload.ts"))?ok("preload 暴露 luminaAnno"):bad("未暴露 luminaAnno"); }
if(exists("src/ui/lumina-bridge.js")){ const s=read("src/ui/lumina-bridge.js"); /getAnnotationsMerged/.test(s)&&/saveAnnotations/.test(s)?ok("bridge getMerged/saveAnnotations"):bad("缺批注桥"); /_annoMem/.test(s)?ok("无后端内存回退"):wn("缺 mock 回退"); }
if(exists("package.json")){ /pdf-lib/.test(read("package.json"))?ok("package.json 含 pdf-lib（导出依赖）"):bad("缺 pdf-lib 依赖"); }

console.log("\n— 4. 导出（pdf-lib 带注释 PDF + 笔记 Markdown）—");
if(exists("src/ui/pdf-export.js")){ const s=read("src/ui/pdf-export.js");
  /export async function exportAnnotatedPdf/.test(s)?ok("exportAnnotatedPdf"):bad("缺 exportAnnotatedPdf");
  /export function exportNotesMarkdown/.test(s)?ok("exportNotesMarkdown"):bad("缺 exportNotesMarkdown");
  /pdf-lib/.test(s)&&/drawRectangle/.test(s)?ok("pdf-lib 绘制高亮（Y 翻转）"):wn("未见 drawRectangle");
  /PDFDocument\.load/.test(s)?ok("基于原字节复制（非破坏）"):wn("未见 load");
}

console.log("\n— 5. 高亮/便签/截取/持久化（Reader）—");
if(exists("src/ui/modules/Reader.jsx")){ const s=read("src/ui/modules/Reader.jsx");
  /function AnnoPanel/.test(s)?ok("批注面板 AnnoPanel（列表/跳页/评论/删除/导出）"):bad("缺 AnnoPanel");
  /addHighlight/.test(s)&&/rd-hl/.test(s)?ok("高亮：创建 + 文本层覆盖渲染"):bad("缺高亮");
  /onNote/.test(s)&&/type: "note"/.test(s)?ok("便签创建"):bad("缺便签");
  /data-page=\{pageNum\}/.test(s)?ok("页锚 data-page（选区定位/坐标）"):bad("缺 data-page");
  /onViewMouseDown/.test(s)&&/rd-snip/.test(s)?ok("截取框选（onViewMouseDown + 选框）"):bad("缺截取");
  /querySelectorAll\(".textLayer span"\)/.test(s)?ok("截取取区域内文本 → 接地解释"):wn("未见区域取文");
  /bridge\.getAnnotationsMerged/.test(s)&&/bridge\.saveAnnotations/.test(s)?ok("会话留存：合并加载/存批注"):bad("缺持久化");
  /clearTimeout\(t\)/.test(s)&&/saveAnnotations\(key, annosRef/.test(s)?ok("关页 flush 防抖批注"):wn("未见 unmount flush");
  /focus-exit|退出专注/.test(s)&&/\.rd\.focus \.rd-toolbar\{display:none/.test(s)?ok("专注模式藏工具栏"):wn("专注模式未加强");
  /可借外部知识/.test(s)&&/askMode/.test(s)?ok("Ask 外部知识模式 UI"):wn("缺 Ask mode UI");
  /loadedRef/.test(s)?ok("载入完成前不覆盖（防空写）"):wn("未见载入门");
  /docKey/.test(s)?ok("以 docKey(文件名+字节长度) 为键"):bad("缺 docKey");
  /exportAnnotatedPdf/.test(s)&&/exportNotesMarkdown/.test(s)?ok("接导出"):bad("未接导出");
  /addHighlight\("yellow"\)/.test(s)?ok("浮条 3 色高亮 + 便签"):wn("浮条颜色未见");
}

console.log("\n— 6. 范围守护（侧车非破坏 · 只单篇 · 非 PDF 编辑器/知识库）—");
let leak=false;
["src/ui/modules/Reader.jsx","src/ui/pdf-export.js","electron/ipc.ts"].forEach((f)=>{ if(!exists(f))return; const s=read(f);
  ["FormField","signature","addPage","removePage","insertPage","跨文档","全库","related-papers","代写"].forEach((b)=>{ if(s.includes(b)){ bad(`${f} 含越界项 "${b}"`); leak=true; } });
});
if(!leak) ok("无越界（仅高亮/便签/AI；非破坏侧车；不增删页/表单/签名；只单篇）");

console.log("\n"+(fail?`\x1b[31m✗ 结构级验证未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：高亮坐标对齐、覆盖渲染、pdf-lib 导出正确性（含旋转）、截取取文、批注持久化往返、便签编辑、无 key→mock、npm install pdf-lib 须真机确认（见 EXIT_CRITERIA）。\n`));
process.exit(fail?1:0);
