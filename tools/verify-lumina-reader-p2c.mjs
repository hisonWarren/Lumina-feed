#!/usr/bin/env node
// 结构级验证 · patch reader_p2c（前置：…+ reader_p2b）。仅改 Reader.jsx。
import fs from "node:fs"; import path from "node:path";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}

console.log("\n— 1. 前置（p2b 翻译后端/桥 + p1b 取文）—");
if(exists("src/ui/lumina-bridge.js")){ /readerTranslate/.test(read("src/ui/lumina-bridge.js"))?ok("bridge.readerTranslate 在（p2b）"):bad("缺 p2b —— 请先应用 reader_p2b"); }
if(exists("src/ui/pdf-engine.js")){ /getPageStrings/.test(read("src/ui/pdf-engine.js"))?ok("getPageStrings 在（p1b）"):bad("缺 p1b getPageStrings"); }
if(exists("electron/ipc.ts")){ read("electron/ipc.ts").includes('"reader:translate"')?ok("reader:translate 后端在"):bad("缺 reader:translate"); }

console.log("\n— 2. Reader.jsx 语法/平衡 —");
if(exists("src/ui/modules/Reader.jsx")&&balance("src/ui/modules/Reader.jsx")) ok("Reader.jsx 括号平衡");

console.log("\n— 3. 翻译三模式 —");
if(exists("src/ui/modules/Reader.jsx")){ const s=read("src/ui/modules/Reader.jsx");
  /function TranslatePanel/.test(s)?ok("TranslatePanel 面板"):bad("缺 TranslatePanel");
  /段内对照/.test(s)&&/仅译文/.test(s)?ok("两模式 段内对照/仅译文（双栏已并入段内对照）"):bad("译文模式不全");
  /rd-tp-stack/.test(s)&&/rd-tp-unit/.test(s)?ok("段内对照=中文为主+英文次级单元布局"):wn("布局类缺");
  /bridge\.readerTranslate/.test(s)?ok("按页调 readerTranslate"):bad("未调 readerTranslate");
  /getPageStrings/.test(s)?ok("按页取文（getPageStrings）"):bad("未取页文本");
  /translateAll/.test(s)?ok("译全部页（整篇）"):wn("缺译全部页");
  /rd-tmenu/.test(s)&&/transMenuOpen/.test(s)?ok("译菜单（overflow:visible 工具栏内，坑①）"):bad("缺译菜单");
  /transMode/.test(s)&&/setAiOpen\(false\)/.test(s)?ok("与助手面板互斥"):wn("互斥未见");
}

console.log("\n— 4. 范围守护 —");
let leak=false; const s=exists("src/ui/modules/Reader.jsx")?read("src/ui/modules/Reader.jsx"):"";
["pdf-lib","FormField","signature","跨文档","全库"].forEach((b)=>{ if(s.includes(b)){bad(`含越界项 "${b}"`);leak=true;} });
if(!leak) ok("无越界（高亮/便签 留 P3；只单篇翻译）");

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：真实按页翻译质量、三模式排版、译全部页表现、无 key→mock 须真机确认。\n`));
process.exit(fail?1:0);
