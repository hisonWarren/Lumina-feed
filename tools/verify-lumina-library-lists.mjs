#!/usr/bin/env node
// 结构级验证 · patch library_lists（前置：library）。单层清单（list）—— 蓝图/01-C 允许；不做嵌套/标签。
import fs from "node:fs"; import path from "node:path";
const ROOT=process.cwd(); let fail=0,warn=0;
const ok=(m)=>console.log("  \x1b[32m✓\x1b[0m "+m); const bad=(m)=>{console.log("  \x1b[31m✗ "+m+"\x1b[0m");fail++;}; const wn=(m)=>{console.log("  \x1b[33m! "+m+"\x1b[0m");warn++;};
const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8"); const exists=(p)=>fs.existsSync(path.join(ROOT,p));
function strip(s){return s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''").replace(/`(?:\\.|[^`\\])*`/g,"``").replace(/\/\/[^\n]*/g," ");}
function balance(p){const s=strip(read(p));for(const[o,c]of[["{","}"],["(",")"],["[","]"]]){const a=s.split(o).length-1,b=s.split(c).length-1;if(a!==b){bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`);return false;}}return true;}

console.log("\n— 1. 前置（library 已应用）—");
if(exists("src/ui/cite.js")) ok("cite.js 在（library）"); else bad("缺 cite.js —— 请先应用 library");
if(exists("src/ui/modules/Library.jsx")){ /STYLES/.test(read("src/ui/modules/Library.jsx"))?ok("Library 在（含引用引擎用法）"):bad("Library 异常"); } else bad("缺 Library.jsx");

console.log("\n— 2. 语法/平衡 —");
["src/ui/modules/Library.jsx","src/ui/LuminaApp.jsx"].forEach((f)=>{ if(exists(f)&&balance(f)) ok(f+" 括号平衡"); });

console.log("\n— 3. 单层清单（Library）—");
if(exists("src/ui/modules/Library.jsx")){ const s=read("src/ui/modules/Library.jsx");
  /onCreateList/.test(s)&&/onToggleInList/.test(s)&&/onDeleteList/.test(s)?ok("清单操作 props（建/加移/删）"):bad("缺清单操作");
  /lib-listbar/.test(s)&&/activeList/.test(s)?ok("清单条 + 按清单过滤（activeList）"):bad("缺清单条/过滤");
  /加入清单/.test(s)&&/lib-lists/.test(s)?ok("每卡「加入清单」内联面板（不进滚动容器，守坑①）"):bad("缺加入清单面板");
  /新建清单/.test(s)&&/onKeyDown/.test(s)?ok("新建清单（回车）"):bad("缺新建清单");
  /lib-lc-del/.test(s)?ok("清单可删除"):wn("未见删除清单");
}

console.log("\n— 4. 壳接线（lists 状态/处理器）—");
if(exists("src/ui/LuminaApp.jsx")){ const s=read("src/ui/LuminaApp.jsx");
  /const \[lists, setLists\]/.test(s)?ok("lists 状态"):bad("缺 lists 状态");
  /createList/.test(s)&&/toggleInList/.test(s)&&/deleteList/.test(s)?ok("建/加移/删 处理器"):bad("缺处理器");
  /ids: L\.ids\.filter\(\(x\) => x !== id\)/.test(s)?ok("移除文献时同步清出清单"):wn("移除未清清单");
  /lists={lists}/.test(s)?ok("传 lists 给 Library"):bad("未传 lists");
}

console.log("\n— 5. 范围守护（仅单层；非嵌套/标签）—");
if(exists("src/ui/modules/Library.jsx")){ const s=read("src/ui/modules/Library.jsx");
  // 单层数据结构：清单仅 {id,name,ids}，不得有 parent/children/nested
  /parentId|children:|parent:|nested|subList|tagTree/.test(s)?bad("出现嵌套/父子/标签树结构（破红线 01-C）"):ok("清单为单层 {id,name,ids}，无父子/嵌套/标签树");
}

console.log("\n"+(fail?`\x1b[31m✗ 未通过：${fail} 错 / ${warn} 警\x1b[0m\n`:`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：清单的建/加移/删/过滤交互、与既有筛选叠加、清单持久化（当前同 lib 为会话内存，引擎库存储后持久）须真机确认。\n`));
process.exit(fail?1:0);
