#!/usr/bin/env node
// 结构级验证 · patch library_engine（引擎：工作集 library + 清单 lists 持久化；library:list 富集 有全文/有总结/总结正文）。
// 触及 electron/*.ts → Node22 --experimental-strip-types --check；类型/真 SQLite/跨进程须真机。批注关联(docKey↔paperId)诚实留后续。
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}
function tsCheck(p){try{execSync(`node --experimental-strip-types --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: strip-types --check 失败 — ${String(e.stderr||e).split("\n").slice(0,3).join(" ")}`);return false;}}
function jsCheck(p){try{execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: node --check 失败`);return false;}}

console.log("\n— 1. 文件与前置（引擎 + library_lists 渲染层）—");
["electron/ipc.ts","electron/preload.ts","src/ui/lumina-bridge.js","src/ui/LuminaApp.jsx","src/ui/modules/Library.jsx"].forEach((f)=>exists(f)?ok(f+" 在"):bad("缺 "+f));
if(exists("src/ui/modules/Library.jsx")){ /lib-listbar/.test(read("src/ui/modules/Library.jsx"))?ok("library_lists 在（清单条）"):bad("缺 library_lists —— 请先应用"); }

console.log("\n— 2. 语法（TS 剥类型 + JS）/ 平衡 —");
tsCheck("electron/ipc.ts")&&ok("ipc.ts strip-types --check 通过"); balance("electron/ipc.ts")&&ok("ipc.ts 平衡");
tsCheck("electron/preload.ts")&&ok("preload.ts strip-types --check 通过");
jsCheck("src/ui/lumina-bridge.js")&&ok("lumina-bridge.js node --check");
(function(){const s=strip(read("src/ui/LuminaApp.jsx"));const a=s.split("(").length-1,b=s.split(")").length-1;if(a===b)ok("LuminaApp.jsx 平衡");else wn("LuminaApp.jsx 括号启发式未过（JSX 可仍合法）");})(); balance("src/ui/modules/Library.jsx")&&ok("Library.jsx 平衡");

console.log("\n— 3. 引擎：工作集 + 清单 持久化（ipc.ts）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /ipcMain\.handle\("library:list"/.test(s)&&/ipcMain\.handle\("library:add"/.test(s)&&/ipcMain\.handle\("library:remove"/.test(s)?ok("library:list/add/remove"):bad("library 处理器不全");
  /ipcMain\.handle\("lists:get"/.test(s)&&/ipcMain\.handle\("lists:save"/.test(s)?ok("lists:get/save"):bad("lists 处理器不全");
  /CREATE TABLE IF NOT EXISTS library/.test(s)?ok("library 表（工作集持久化）"):bad("缺 library 表");
  /readSummaryText/.test(s)?ok("有总结含阅读器 summary 回退"):bad("未读 summaries/reader summary");
  /"library:importLocal"/.test(s)?ok("library:importLocal IPC"):bad("缺 library:importLocal");
  /existsSync\(pdfPath/.test(s)?ok("有全文据已落盘 PDF 判定"):wn("未据 pdf 判定有全文");
}

console.log("\n— 4. preload 暴露 —");
if(exists("electron/preload.ts")){ const s=read("electron/preload.ts");
  /libraryList:.*invoke\("library:list"\)/.test(s)&&/libraryAdd:.*invoke\("library:add"/.test(s)&&/listsSave:.*invoke\("lists:save"/.test(s)?ok("luminaApi 暴露 library*/lists*"):bad("preload 未暴露");
}

console.log("\n— 5. bridge：映射 + 富集 + mock —");
if(exists("src/ui/lumina-bridge.js")){ const s=read("src/ui/lumina-bridge.js");
  /libraryList[\s\S]{0,500}toCardModel/.test(s)?ok("libraryList 引擎 Paper→卡片 + 富集（hasSummary/summary/_fetched）"):bad("libraryList 未映射/富集");
  /libraryImportLocal/.test(s)?ok("bridge libraryImportLocal"):bad("bridge 缺 libraryImportLocal");
  /libraryAdd/.test(s)&&/libraryRemove/.test(s)&&/listsGet/.test(s)&&/listsSave/.test(s)?ok("libraryAdd/Remove + listsGet/Save"):bad("bridge 方法不全");
  /_libMem/.test(s)&&/_listsMem/.test(s)?ok("无后端会话内存回退"):wn("缺 mock");
}

console.log("\n— 6. 渲染层接线 —");
if(exists("src/ui/LuminaApp.jsx")){ const s=read("src/ui/LuminaApp.jsx");
  /bridge\.libraryList\(\)/.test(s)&&/bridge\.listsGet\(\)/.test(s)?ok("挂载从引擎载入 lib + lists"):bad("未载入");
  /bridge\.libraryAdd/.test(s)&&/bridge\.libraryRemove/.test(s)?ok("收藏/移除 持久化"):bad("收藏/移除未持久");
  /bridge\.listsSave/.test(s)?ok("清单变更 持久化"):bad("清单未持久");
  /onImportToLibrary/.test(s)&&/onImportLocal/.test(s)?ok("阅读台导入工作集接线"):bad("缺导入工作集接线");
}
if(exists("src/ui/modules/Library.jsx")){ const s=read("src/ui/modules/Library.jsx");
  /fSummary/.test(s)&&/有总结/.test(s)?ok("有总结 chip + 筛选"):bad("缺 有总结");
  /p\.summary/.test(s)?ok("搜索覆盖 AI 总结正文"):wn("搜索未含总结正文");
  /_fetched/.test(s)?ok("有全文兼顾引擎 _fetched"):wn("有全文未兼顾引擎态");
}

console.log("\n— 7. 红线/范围 + 诚实分层 —");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /paperId↔docKey|docKey/.test(s)?ok("批注关联(docKey↔paperId)注明留后续（不伪造批注数）"):wn("未注明批注分层");
  let leak=false; ["facet(","hitCount","深分页","证据分级"].forEach((b)=>{ if(s.includes(b)){bad(`疑似越界 "${b}"`);leak=true;} });
  if(!leak) ok("library:list 仅平铺工作集 + 富集（无分面/命中总数/深分页）—— 工作集非数据库");
}

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：TS 类型正确性、真实 SQLite 持久化（工作集/清单跨重启）、有总结/总结正文取自 summaries、跨进程 IPC 须真机（npm run build:electron && npm start）。批注数/有批注/搜批注 与 PDF 正文 FTS 为后续（需 paperId↔docKey 映射 / PDF 抽取）。\n`));
process.exit(fail?1:0);
