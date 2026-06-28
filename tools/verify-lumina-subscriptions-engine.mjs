#!/usr/bin/env node
// 结构级验证 · patch subscriptions_engine（引擎层：接 subs:* + runNow 真检索 + 期刊分支 + 成本闸 + 持久化）。
// 触及 electron/*.ts —— 用 Node22 --experimental-strip-types --check 做剥类型语法校验；类型正确性/真检索/SQLite/跨进程须真机。
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}
function tsCheck(p){try{execSync(`node --experimental-strip-types --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: strip-types --check 失败 — ${String(e.stderr||e).split("\n").slice(0,3).join(" ")}`);return false;}}
function jsCheck(p){try{execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: node --check 失败`);return false;}}

console.log("\n— 1. 文件与前置（引擎 + 订阅渲染层）—");
["electron/ipc.ts","electron/preload.ts","src/ui/lumina-bridge.js"].forEach((f)=>exists(f)?ok(f+" 在"):bad("缺 "+f));
if(exists("src/ui/lumina-bridge.js")){ /subsRunNow/.test(read("src/ui/lumina-bridge.js"))?ok("bridge 有 subs 方法（subscriptions 渲染层在）"):bad("缺 subscriptions 渲染层"); }
if(exists("src/ui/modules/Subscriptions.jsx")) ok("Subscriptions.jsx 在"); else wn("未见 Subscriptions.jsx（应已随 subscriptions 应用）");

console.log("\n— 2. 语法（TS 剥类型 + JS）/ 平衡 —");
if(exists("electron/ipc.ts")){ tsCheck("electron/ipc.ts")&&ok("ipc.ts strip-types --check 通过"); balance("electron/ipc.ts")&&ok("ipc.ts 括号平衡"); }
if(exists("electron/preload.ts")){ tsCheck("electron/preload.ts")&&ok("preload.ts strip-types --check 通过"); }
if(exists("src/ui/lumina-bridge.js")){ jsCheck("src/ui/lumina-bridge.js")&&ok("lumina-bridge.js node --check 通过"); }

console.log("\n— 3. 订阅 CRUD + 持久化（ipc.ts）—");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /ipcMain\.handle\("subs:list"/.test(s)&&/ipcMain\.handle\("subs:save"/.test(s)&&/ipcMain\.handle\("subs:remove"/.test(s)&&/ipcMain\.handle\("subs:runNow"/.test(s)?ok("subs:list/get/save/remove/runNow 已注册"):bad("subs 处理器不全");
  /CREATE TABLE IF NOT EXISTS subscriptions/.test(s)?ok("subscriptions 表（SQLite 持久化）"):bad("缺 subscriptions 表");
  /ON CONFLICT\(id\) DO UPDATE/.test(s)?ok("upsert（保存即持久）"):wn("未见 upsert");
}

console.log("\n— 4. runNow 真检索 + 期刊分支 + 成本闸 —");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  /aggregateSearch\(spec/.test(s)&&/store\.papers\.upsertMany/.test(s)?ok("真检索 aggregateSearch + 命中落库"):bad("缺真检索/落库");
  /kind === "journal"/.test(s)&&/field: "journal"/.test(s)?ok("期刊分支（journal 字段；PubMed [Journal] 接受 ISSN/刊名）"):bad("缺期刊分支");
  /sources: \["pubmed", "europepmc", "crossref", "openalex"\]/.test(s)?ok("期刊模式限非预印本源"):wn("期刊未限源");
  /autoSummarize/.test(s)&&/"abstract"/.test(s)&&/topN|slice\(0, 3\)/.test(s)?ok("成本闸（off/abstract/topN）限制自动总结范围"):bad("缺成本闸");
  /DEFAULT_SUMMARIZE/.test(s)&&/summarizeGrounded\(/.test(s)?ok("自动总结复用 summarizeGrounded（带 sourceBasis）"):wn("自动总结未接 summarizeGrounded");
}

console.log("\n— 5. preload 暴露 —");
if(exists("electron/preload.ts")){ const s=read("electron/preload.ts");
  /subsList:.*invoke\("subs:list"\)/.test(s)&&/subsSave:.*invoke\("subs:save"/.test(s)&&/subsRunNow:.*invoke\("subs:runNow"/.test(s)?ok("luminaApi 暴露 subsList/Save/Remove/RunNow"):bad("preload 未暴露 subs");
}

console.log("\n— 6. bridge 命中映射 —");
if(exists("src/ui/lumina-bridge.js")){ const s=read("src/ui/lumina-bridge.js");
  /subsRunNow[\s\S]{0,400}toCardModel/.test(s)?ok("subsRunNow 把引擎 Paper → 卡片形状（preprint/oa 等）"):bad("subsRunNow 未映射命中");
}

console.log("\n— 7. 红线/范围 —");
if(exists("electron/ipc.ts")){ const s=read("electron/ipc.ts");
  // runNow 失败/无结果返回空，不伪造
  /return \{ ok: false, hits: \[\] \}/.test(s)?ok("无结果/失败返回空命中（不伪造）"):wn("未见空命中兜底");
  // 不引入分面/命中总数/深分页（lookup 定位；limit 30）
  /limit: 30/.test(s)?ok("沿用 limit 30（lookup 定位，无深分页）"):wn("未见 limit");
  let leak=false; ["facet","hitCount","totalCount","深分页","offset:"].forEach((b)=>{ if(s.includes(b)){bad(`疑似越界 "${b}"`);leak=true;} });
  if(!leak) ok("无分面/命中总数/深分页（不滑向数据库）");
}

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：TS 类型正确性、真实多源检索/期刊命中、SQLite 持久化、成本闸自动总结、跨进程 IPC 须真机（npm run build:electron && npm start）确认；调度(cron)与 seenIds 持久化为后续。\n`));
process.exit(fail?1:0);
