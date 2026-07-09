#!/usr/bin/env node
function jsxSyntaxCheck(p) {
  try { execSync(`node tools/jsx-syntax-check.mjs ${p}`, { stdio: "pipe", cwd: process.cwd() }); return true; }
  catch { return false; }
}
// 结构级验证 · 组合大包 engine_finish = library_engine（工作集/清单持久化+有总结）+ 批注关联（docKey→paperId）+ 订阅调度（cron）。
// 自洽叠在 subscriptions_engine 基线（含 library_engine，无需先装它）。electron/*.ts 用 strip-types --check；真 SQLite/调度时序/通知/真检索须真机。
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}
function tsCheck(p){try{execSync(`node --experimental-strip-types --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: strip-types 失败 — ${String(e.stderr||e).split("\n").slice(0,3).join(" ")}`);return false;}}
function jsCheck(p){try{execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: node --check 失败`);return false;}}

console.log("\n— 1. 文件与前置 —");
["electron/ipc.ts","electron/main.ts","electron/preload.ts","src/ui/lumina-bridge.js","src/ui/LuminaApp.jsx","src/ui/modules/Library.jsx","src/ui/modules/Reader.jsx","src/ui/modules/ReadHub.jsx"].forEach((f)=>exists(f)?ok(f.split("/").pop()+" 在"):bad("缺 "+f));
if(exists("electron/ipc.ts")) /ipcMain\.handle\("subs:list"/.test(read("electron/ipc.ts"))?ok("subscriptions_engine 在（前置）"):bad("缺 subscriptions_engine");
if(exists("src/ui/modules/Library.jsx")) /lib-listbar/.test(read("src/ui/modules/Library.jsx"))?ok("library_lists 在（前置）"):bad("缺 library_lists");

console.log("\n— 2. 语法（TS 剥类型 + JS）/ 平衡 —");
tsCheck("electron/ipc.ts")&&ok("ipc.ts strip-types"); balance("electron/ipc.ts")&&ok("ipc.ts 平衡");
tsCheck("electron/main.ts")&&ok("main.ts strip-types");
tsCheck("electron/preload.ts")&&ok("preload.ts strip-types");
jsCheck("src/ui/lumina-bridge.js")&&ok("lumina-bridge.js node --check");
jsxSyntaxCheck("src/ui/LuminaApp.jsx")&&ok("LuminaApp.jsx 语法（jsx-syntax-check）");

console.log("\n— 3. library_engine：工作集/清单持久化 + 有总结 —");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /ipcMain\.handle\("library:list"/.test(s)&&/ipcMain\.handle\("library:add"/.test(s)&&/ipcMain\.handle\("library:remove"/.test(s)?ok("library:list/add/remove"):bad("library 处理器不全");
  /ipcMain\.handle\("lists:get"/.test(s)&&/ipcMain\.handle\("lists:save"/.test(s)?ok("lists:get/save"):bad("lists 处理器不全");
  /CREATE TABLE IF NOT EXISTS library/.test(s)?ok("library 表"):bad("缺 library 表");
  /SELECT text FROM summaries WHERE paper_id=\?/.test(s)?ok("有总结/正文取自 summaries(paper_id)"):bad("未读 summaries");
}
if(exists("electron/preload.ts")) /libraryList:.*invoke\("library:list"\)/.test(read("electron/preload.ts"))&&/listsSave:.*invoke\("lists:save"/.test(read("electron/preload.ts"))?ok("preload 暴露 library*/lists*"):bad("preload 未暴露 library/lists");
if(exists("src/ui/LuminaApp.jsx")){ const s=read("src/ui/LuminaApp.jsx");
  /bridge\.libraryList\(\)/.test(s)&&/bridge\.listsGet\(\)/.test(s)?ok("挂载载入 lib+lists"):bad("未载入");
  /bridge\.libraryAdd/.test(s)&&/bridge\.libraryRemove/.test(s)&&/bridge\.listsSave/.test(s)?ok("收藏/移除/清单 持久化"):bad("持久化不全");
}
if(exists("src/ui/modules/Library.jsx")) /fSummary/.test(read("src/ui/modules/Library.jsx"))&&/有总结/.test(read("src/ui/modules/Library.jsx"))?ok("有总结 chip"):bad("缺 有总结");

console.log("\n— 4. 批注关联（docKey→paperId）—");
if(exists("src/ui/modules/Reader.jsx")) /readerDocKey/.test(read("src/ui/modules/Reader.jsx"))&&/analysisDocKey/.test(read("src/ui/modules/Reader.jsx"))?ok("Reader docKey 隔离（readerDocKey）"):bad("Reader docKey 未改");
if(exists("src/ui/modules/ReadHub.jsx")) /paperId: it\.paperId/.test(read("src/ui/modules/ReadHub.jsx"))?ok("ReadHub 开已下载全文带 paperId"):bad("ReadHub 未传 paperId");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /anno:paper:/.test(s)&&/annoCount/.test(s)&&/annoText/.test(s)?ok("library:list 数批注 + 批注正文（anno:paper:<id>）"):bad("library:list 未关联批注");
}
if(exists("src/ui/lumina-bridge.js")) /annoCount: r\.annoCount/.test(read("src/ui/lumina-bridge.js"))&&/annoText: r\.annoText/.test(read("src/ui/lumina-bridge.js"))?ok("bridge 透传 annoCount/annoText"):bad("bridge 未透传批注");
if(exists("src/ui/modules/Library.jsx")){ const s=read("src/ui/modules/Library.jsx");
  /fAnno/.test(s)&&/有批注/.test(s)?ok("有批注 chip + 筛选"):bad("缺 有批注 chip");
  /annoText/.test(s)?ok("搜索覆盖批注正文"):bad("搜索未含批注正文");
}

console.log("\n— 5. 订阅调度（cron）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /function runSubscriptionNow/.test(s)?ok("runSubscriptionNow 抽出（手动+调度共用）"):bad("未抽 runSubscriptionNow");
  /ipcMain\.handle\("subs:runNow", async \(_e, sub: any\) => runSubscriptionNow/.test(s)?ok("subs:runNow 复用核心"):wn("runNow 未复用核心");
  /export function startSubsScheduler/.test(s)?ok("startSubsScheduler 导出"):bad("缺调度器");
  /function isSubDue/.test(s)&&/setInterval/.test(s)&&/setTimeout/.test(s)?ok("到期判定 + 定时（启动后+周期）"):bad("调度时序不全");
  (/persistSubscriptionToday/.test(s) && /today: todayMerged/.test(s) && /lastRunAt/.test(s))?ok("持久化 today(上限50)+lastRunAt（persistSubscriptionToday + freshHits 去重）"):bad("未持久化 today/lastRunAt");
  /Notification\.isSupported\(\)/.test(s)?ok("命中系统通知（guarded）"):wn("无通知");
}
if(exists("electron/main.ts")) /startSubsScheduler\(store, secrets\)/.test(read("electron/main.ts"))?ok("main.ts 启动调度器"):bad("main.ts 未启动调度器");
if(exists("src/ui/lumina-bridge.js")) /subsList[\s\S]{0,300}today[\s\S]{0,120}toCardModel/.test(read("src/ui/lumina-bridge.js"))?ok("subsList 映射持久化 today → 卡片形状"):bad("subsList 未映射 today");

console.log("\n— 6. 红线/范围 + 诚实分层 —");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /sources: \["pubmed", "europepmc", "crossref", "openalex"\]/.test(s)?ok("期刊订阅限非预印本源（沿用）"):wn("期刊未限源");
  /DEFAULT_SUMMARIZE/.test(s)&&/summarizeGrounded\(/.test(s)?ok("自动总结带 sourceBasis；成本闸约束（off/abstract/topN）"):wn("成本闸/接地未见");
  let leak=false; ["facet(","hitCount","深分页","证据分级"].forEach((b)=>{ if(s.includes(b)){bad(`疑似越界 "${b}"`);leak=true;} });
  if(!leak) ok("无分面/命中总数/深分页（不滑向数据库）；调度=追新，纳入由人（红线2）");
}

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n须真机（npm run build:electron && npm start）：TS 类型/真 SQLite 持久化（工作集·清单·订阅 today 跨重启）/批注按 paper:<id> 关联计数/调度器时序与去重/系统通知/真实多源检索。PDF 正文 FTS5 仍为后续（需 PDF 抽取）。\n`));
process.exit(fail?1:0);
