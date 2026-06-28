#!/usr/bin/env node
// 结构级验证 · patch subscriptions_journal（前置：subscriptions）。订阅加"按期刊(ISSN 锚定)"类型；引擎期刊检索分支待 electron/。
import fs from "node:fs"; import path from "node:path";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}

console.log("\n— 1. 前置（subscriptions 已应用）—");
if(exists("src/ui/modules/Subscriptions.jsx")){ /今日证据简报/.test(read("src/ui/modules/Subscriptions.jsx"))?ok("Subscriptions 在"):bad("缺 subscriptions —— 请先应用"); } else bad("缺 Subscriptions.jsx");
if(exists("src/ui/lumina-bridge.js")){ /subsSave/.test(read("src/ui/lumina-bridge.js"))?ok("bridge subsSave 在（透传订阅对象）"):bad("缺 subsSave"); }

console.log("\n— 2. 语法/平衡 —");
if(exists("src/ui/modules/Subscriptions.jsx")&&balance("src/ui/modules/Subscriptions.jsx")) ok("Subscriptions.jsx 括号平衡");

console.log("\n— 3. 按期刊订阅 —");
if(exists("src/ui/modules/Subscriptions.jsx")){ const s=read("src/ui/modules/Subscriptions.jsx");
  /按关键词/.test(s)&&/按期刊/.test(s)?ok("类型切换（关键词 / 期刊）"):bad("缺类型切换");
  /kind === "journal"/.test(s)?ok("按 kind 分支构造订阅"):bad("缺 kind 分支");
  /journal: \{ name: jName/.test(s)?ok("期刊订阅模型 journal{name,issn}"):bad("缺 journal 模型");
  /issn/i.test(s)?ok("ISSN 锚定（更精准）"):bad("缺 ISSN");
  /subLabel/.test(s)&&/subKind/.test(s)?ok("订阅显示名/类型 helper（轨+简报通用）"):wn("缺 label helper");
  /PubMed|Crossref|OpenAlex/.test(s)?ok("引擎期刊匹配诚实标注（各源）"):wn("未标注引擎来源");
}

console.log("\n— 4. 不破既有订阅能力（红线/范围）—");
if(exists("src/ui/modules/Subscriptions.jsx")){ const s=read("src/ui/modules/Subscriptions.jsx");
  /autoSummarize/.test(s)?ok("成本闸仍在"):bad("成本闸丢失");
  const badgeSrc = exists("src/ui/FetchBadges.jsx") ? read("src/ui/FetchBadges.jsx") : s;
  /未经同行评议/.test(badgeSrc) && /已撤稿/.test(badgeSrc) ? ok("预印本/撤稿标注仍在（红线5/6）") : bad("标注丢失");
  /由你判断/.test(s)?ok("纳入由人（红线2）仍在"):bad("判断归属丢失");
  /markRead|seen/.test(s)?ok("标记已读仍在"):bad("已读丢失");
  let leak=false; ["facet","分面","命中总数","hitCount","深分页","星图","证据分级","期刊指标","全部期刊目录","浏览全部"].forEach((b)=>{ if(s.includes(b)){bad(`含越界项 "${b}"`);leak=true;} });
  if(!leak) ok("无越界（按刊=追新跟踪器子类；不做期刊浏览器/全目录/分面/指标）");
}

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：按期刊订阅的建/编辑/显示为渲染层；真实期刊命中（引擎按 ISSN/刊名检索各源 + 刊名→ISSN 解析 + Crossref/OpenAlex ISSN 过滤适配）须 electron/ 引擎，真机确认。\n`));
process.exit(fail?1:0);
