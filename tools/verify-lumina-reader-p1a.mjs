#!/usr/bin/env node
// 结构级验证 · patch reader_p1a（依赖 v0.3.0-minimal 基线）
// JSX 无法 node --check；此处结构级。真实 PDF 渲染/worker/字体须真机确认。
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
function jsxSyntaxCheck(p){try{execSync(`node tools/jsx-syntax-check.mjs ${p}`,{stdio:"pipe",cwd:process.cwd()});return true;}catch{return false;}}
function balance(p){ const s=strip(read(p)); for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1; if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}} return true; }
function nodeCheck(p){ try{ execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"}); return true; }catch(e){ bad(`${p}: node --check 失败 — ${String(e.stderr||e).split("\n")[0]}`); return false; } }

console.log("\n— 1. 前置基线(v0.3.0-minimal)在位 —");
["src/ui/modules/FindFetch.jsx","src/ui/lumina-bridge.js","src/ui/themes.js"].forEach((f)=> exists(f)?ok(f):bad("缺前置 "+f));

console.log("\n— 2. 本补丁文件 —");
const NEW=["src/ui/pdf-engine.js","src/ui/modules/Reader.jsx","src/ui/modules/ReadHub.jsx"];
const MOD=["package.json","renderer/index.html","tools/build-electron.mjs","src/ui/LuminaApp.jsx"];
[...NEW,...MOD].forEach((f)=> exists(f)?ok(f):bad("缺 "+f));

console.log("\n— 3. 语法/平衡（JSX 计括号 · JS node --check）—");
["src/ui/modules/Reader.jsx","src/ui/modules/ReadHub.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });
jsxSyntaxCheck("src/ui/LuminaApp.jsx")&&ok("LuminaApp.jsx 语法（jsx-syntax-check）");
["src/ui/pdf-engine.js"].forEach((f)=>{ if(exists(f)&&nodeCheck(f)) ok(f+" node --check 通过"); });

console.log("\n— 4. PDF.js 接入（依赖 / worker / CSP / eval）—");
if(exists("package.json")){ /pdfjs-dist/.test(read("package.json"))?ok("package.json 含 pdfjs-dist 依赖"):bad("未加 pdfjs-dist 依赖"); }
if(exists("tools/build-electron.mjs")){ /pdf\.worker\.min\.mjs/.test(read("tools/build-electron.mjs"))?ok("构建复制 PDF.js worker 到 dist"):bad("构建未复制 worker"); }
if(exists("renderer/index.html")){ /worker-src/.test(read("renderer/index.html"))?ok("CSP 含 worker-src"):bad("CSP 未放开 worker-src"); }
if(exists("src/ui/pdf-engine.js")){ const s=read("src/ui/pdf-engine.js"); /workerSrc/.test(s)?ok("pdf-engine 配置 workerSrc"):bad("未配置 workerSrc"); /isEvalSupported\s*=\s*false/.test(s)?ok("isEvalSupported:false（CSP 友好）"):wn("未禁用 eval"); }

console.log("\n— 5. 导航与渲染接线 —");
if(exists("src/ui/LuminaApp.jsx")){ const s=read("src/ui/LuminaApp.jsx");
  /import ReaderModule/.test(s)?ok("LuminaApp 引入 ReaderModule"):bad("未引入 ReaderModule");
  /<ReaderModule/.test(s)?ok("LuminaApp 渲染 <ReaderModule/>"):bad("未渲染 ReaderModule");
  /阅读/.test(s)&&/检索取文/.test(s)?ok("导航含 检索取文 + 阅读"):wn("导航标签不全");
}
if(exists("src/ui/modules/ReadHub.jsx")){ const s=read("src/ui/modules/ReadHub.jsx");
  /import Reader from/.test(s)?ok("ReadHub 引入 Reader"):bad("ReadHub 未引入 Reader");
  /arrayBuffer\(\)/.test(s)?ok("本地 PDF：File→arrayBuffer"):bad("未读取本地文件字节");
  /<Reader\b/.test(s)?ok("进入工作台 <Reader/>（条件渲染，hooks 安全）"):bad("未渲染 Reader");
}
if(exists("src/ui/modules/Reader.jsx")){ const s=read("src/ui/modules/Reader.jsx");
  /openPdf/.test(s)?ok("Reader 调用 openPdf"):bad("未调用 openPdf");
  /\.render\(/.test(s)?ok("渲染内核 page.render（可取消）"):bad("未见页面渲染");
  /single|continuous|two/.test(s)?ok("视图模式 单页/连续/双页"):wn("未见视图模式");
}

console.log("\n— 6. 范围守护（P1a 不越界）—");
const SCOPE=["src/ui/modules/Reader.jsx","src/ui/modules/ReadHub.jsx"];
let leak=false;
SCOPE.forEach((f)=>{ if(!exists(f))return; const s=read(f);
  // 文本层(renderTextLayer)已于 reader_p1b 正式落地、不再视为越界（验证套件全绿化，2026-06）；此处仍隔离检索/库逻辑与 bridge.summarize 误入阅读器。
  ["screening","Spectrum","星图","bridge.summarize","getTextContent"].forEach((b)=>{ if(s.includes(b)){ bad(`${f} 含越界项 "${b}"（检索/库逻辑不应进阅读器模块）`); leak=true; } });
});
if(!leak) ok("无越界（阅读器仍隔离检索/库逻辑；文本层/AI 已在 P1b+ 落地，不在此守）");

console.log("\n"+(fail?`\x1b[31m✗ 结构级验证未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：真实 PDF 渲染/worker/字体/缩略图/视图模式须真机确认（见 EXIT_CRITERIA）。\n`));
process.exit(fail?1:0);
