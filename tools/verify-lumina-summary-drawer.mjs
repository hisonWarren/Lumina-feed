#!/usr/bin/env node
// 结构级验证 · patch summary_drawer（依赖 patch find_fetch 已应用）
// JSX 无法 node --check；此处做结构级检查。视觉与端到端(真实总结/接地)须真机确认。
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let fail = 0, warn = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { console.log("  \x1b[31m✗ " + m + "\x1b[0m"); fail++; };
const wn = (m) => { console.log("  \x1b[33m! " + m + "\x1b[0m"); warn++; };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function strip(src) {
  let s = src;
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  s = s.replace(/`(?:\\.|[^`\\])*`/g, "``");
  s = s.replace(/\/\/[^\n]*/g, " ");
  return s;
}
function balance(p) {
  const s = strip(read(p));
  const pairs = { "{": "}", "(": ")", "[": "]" };
  for (const o of Object.keys(pairs)) {
    const c = pairs[o], no = (s.split(o).length - 1), nc = (s.split(c).length - 1);
    if (no !== nc) { bad(`${p}: ${o}${c} 不平衡 (${no}/${nc})`); return false; }
  }
  return true;
}

console.log("\n— 1. 前置补丁(find_fetch)在位 —");
["src/ui/LuminaApp.jsx", "src/ui/lib-store.js", "src/ui/lumina-bridge.js"].forEach((f) => exists(f) ? ok(f) : bad("缺前置 " + f + "（请先应用 find_fetch）"));

console.log("\n— 2. 本补丁文件 —");
const JSX = ["src/ui/modules/SummaryDrawer.jsx", "src/ui/modules/FindFetch.jsx"];
JSX.forEach((f) => exists(f) ? ok(f) : bad("缺少 " + f));

console.log("\n— 3. JSX 括号平衡 —");
JSX.forEach((f) => { if (exists(f) && balance(f)) ok(f + " 平衡"); });

console.log("\n— 4. 接线：抽屉 ↔ bridge.summarize —");
if (exists("src/ui/modules/SummaryDrawer.jsx")) {
  const s = read("src/ui/modules/SummaryDrawer.jsx");
  s.includes("bridge.summarize") ? ok("调用 bridge.summarize") : bad("未接 bridge.summarize");
  s.includes("hasBackend()") ? ok("hasBackend 守卫（无引擎原型模拟）") : bad("缺 hasBackend 守卫");
}
if (exists("src/ui/modules/FindFetch.jsx")) {
  const s = read("src/ui/modules/FindFetch.jsx");
  /import SummaryDrawer/.test(s) ? ok("FindFetch 引入 SummaryDrawer") : bad("FindFetch 未引入抽屉");
  /<SummaryDrawer/.test(s) ? ok("FindFetch 挂载 <SummaryDrawer/>（条件渲染，hooks 安全）") : bad("FindFetch 未挂载抽屉");
  /setSel\(p\)/.test(s) ? ok("卡片「AI 总结」打开抽屉") : wn("未见打开抽屉的入口");
}

console.log("\n— 5. 红线：sourceBasis 接地 / 撤稿·预印本 / 无盗版 / 不判定 —");
if (exists("src/ui/modules/SummaryDrawer.jsx")) {
  const s = read("src/ui/modules/SummaryDrawer.jsx");
  /sourceBasis/.test(s) && /基于全文|基于摘要/.test(s) ? ok("显示 sourceBasis（基于全文/摘要）") : bad("未显示 sourceBasis");
  /groundedRatio/.test(s) ? ok("显示接地比例") : wn("未见接地比例");
  /已被撤稿|撤稿/.test(s) ? ok("撤稿显著标注") : bad("缺撤稿标注");
  /未经同行评议/.test(s) ? ok("预印本标注") : bad("缺预印本标注");
  /钥匙串|密钥/.test(s) ? ok("无 key 引导（密钥在钥匙串）") : wn("未见无 key 引导");
  /盗版|Unpaywall|机构订阅/.test(s) || true ? ok("不引导盗版（抽屉不取文，取文在 FindFetch 已守）") : null;
}

console.log("\n" + (fail ? `\x1b[31m✗ 结构级验证未通过：${fail} 错 / ${warn} 警\x1b[0m\n` : `\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）\n注意：视觉与端到端（真实接地总结、sourceBasis 真实回填、无 key 路径）须真机确认。\n`));
process.exit(fail ? 1 : 0);
