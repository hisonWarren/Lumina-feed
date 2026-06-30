#!/usr/bin/env node
// 结构级验证 · patch subscriptions（前置：library_lists）。订阅 CRUD/成本闸/今日简报；今日命中需引擎调度（无引擎不伪造）。
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));let okAll=true;
  for(const[o,c]of[["{","}"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);okAll=false;}}
  // () 裸计数对含正则字面量 / 模板串 / JSX 文本的文件不可靠（LuminaApp 误报源）；降级为提示，语法真值以 build:electron(esbuild) 为准
  for(const[o,c]of[["(",")"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b)wn(`${p}: () 可能不平衡 (${a}/${b}) —— 裸计数对 JSX/正则不可靠，以 build:electron 为准`);}
  return okAll;}
function nodeCheck(p){try{execSync(`node --check "${path.join(ROOT,p)}"`,{stdio:"pipe"});return true;}catch(e){bad(`${p}: node --check 失败 — ${String(e.stderr||e).split("\n")[0]}`);return false;}}

console.log("\n— 1. 前置（library_lists 已应用）—");
if(exists("src/ui/modules/Library.jsx")){ /lib-listbar/.test(read("src/ui/modules/Library.jsx"))?ok("library_lists 在（清单条）"):bad("缺 library_lists —— 请先应用"); } else bad("缺 Library.jsx");
exists("src/ui/modules/Subscriptions.jsx")?ok("Subscriptions.jsx 新增"):bad("缺 Subscriptions.jsx");

console.log("\n— 2. 语法/平衡 —");
["src/ui/modules/Subscriptions.jsx","src/ui/LuminaApp.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });
if(exists("src/ui/lumina-bridge.js")&&nodeCheck("src/ui/lumina-bridge.js")) ok("lumina-bridge.js node --check 通过");

console.log("\n— 3. bridge 订阅方法（接引擎 + mock）—");
if(exists("src/ui/lumina-bridge.js")){ const s=read("src/ui/lumina-bridge.js");
  /subsList/.test(s)&&/subsSave/.test(s)&&/subsRemove/.test(s)&&/subsRunNow/.test(s)?ok("subsList/Save/Remove/RunNow"):bad("订阅桥方法不全");
  /_subsMem/.test(s)?ok("无后端会话内存回退"):wn("缺 mock");
  /mock: true, hits: \[\]/.test(s)?ok("无引擎 runNow 不伪造命中（honest）"):wn("runNow mock 未确认空命中");
}

console.log("\n— 4. 订阅 UI（轨/简报/对话框/成本闸）—");
if(exists("src/ui/modules/Subscriptions.jsx")){ const s=read("src/ui/modules/Subscriptions.jsx");
  /subs-rail/.test(s)&&/新建订阅/.test(s)?ok("订阅轨 + 新建"):bad("缺订阅轨");
  /subPatch.*enabled|enabled: s\.enabled === false/.test(s)?ok("暂停/恢复"):wn("暂停/恢复未确认");
  /subRemove/.test(s)&&/subRunNow/.test(s)?ok("删除 + 立即运行"):bad("缺删除/立即运行");
  /function SubDialog/.test(s)&&/autoSummarize/.test(s)?ok("新建/编辑对话框 + 成本闸（autoSummarize）"):bad("缺对话框/成本闸");
  /AUTO_OPTS|关闭.*仅摘要.*Top|off.*abstract.*topN/.test(s)?ok("成本闸三档（关闭/仅摘要/Top-N）"):wn("成本闸档位未确认");
  /今日证据简报/.test(s)&&/取本批全部|allPending/.test(s)?ok("今日证据简报 + 一键批量取全文"):bad("缺简报/批量取文");
  /markRead|seen/.test(s)?ok("标记已读（seen）"):bad("缺标记已读");
  const badgeSrc = exists("src/ui/FetchBadges.jsx") ? read("src/ui/FetchBadges.jsx") : s;
  /未经同行评议/.test(badgeSrc)?ok("预印本标注（红线5）"):bad("缺预印本标注");
  /已撤稿|retracted/.test(badgeSrc)?ok("撤稿标注（红线6）"):bad("缺撤稿标注");
  /FetchBadges|fetchedMeta/.test(s)?ok("共享取文徽章/状态"):wn("未接 fetch-meta 层");
  /由你判断/.test(s)?ok("纳入与否由人判断（红线2）"):wn("未见判断归属声明");
  /hasBackend|backend/.test(s)&&/需引擎调度/.test(s)?ok("无引擎诚实标注（不伪造命中）"):wn("未见无引擎标注");
}

console.log("\n— 5. 壳接线 —");
if(exists("src/ui/LuminaApp.jsx")){ const s=read("src/ui/LuminaApp.jsx");
  /import Subscriptions from/.test(s)?ok("引入 Subscriptions"):bad("未引入");
  (/view === "subs"/.test(s) || /mode === "subs"/.test(s))?ok("渲染 Subscriptions"):bad("未渲染");
  /订阅简报/.test(s)?ok("订阅简报 tab"):bad("缺 tab");
}

console.log("\n— 6. 范围守护（追踪器，非数据库）—");
let leak=false; const s=exists("src/ui/modules/Subscriptions.jsx")?read("src/ui/modules/Subscriptions.jsx"):"";
["facet","分面","命中总数","hitCount","深分页","星图","证据分级","跨文档"].forEach((b)=>{ if(s.includes(b)){bad(`含越界项 "${b}"`);leak=true;} });
if(!leak) ok("无越界（按主题追新 + 成本闸；不做分面/命中总数/深分页/证据判决）");

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：订阅 CRUD/成本闸/简报渲染/标记已读/批量取 OA 交互，及今日命中（需引擎按计划检索 PubMed 等）、订阅持久化（钥匙/SQLite）须真机确认。\n`));
process.exit(fail?1:0);
