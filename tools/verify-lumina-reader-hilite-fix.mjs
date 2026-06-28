#!/usr/bin/env node
// verify-lumina-reader-hilite-fix.mjs — 结构级校验（对已应用的仓库；无网络/无视觉）。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.argv[2] || ".";
const FILE = join(ROOT, "src/ui/modules/Reader.jsx");
let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✓ " + m); pass++; };
const ng = (m) => { console.log("  ✗ " + m); fail++; };

if (!existsSync(FILE)) { ng("找不到 " + FILE); process.exit(1); }
const s = readFileSync(FILE, "utf8");
const c = (ch) => (s.match(new RegExp("\\" + ch, "g")) || []).length;

console.log("\n[1] 修复规则已就位（高特异性，压过 .rd-pop-bar button）");
for (const r of [
  ".rd-pop-bar button.rd-hlbtn{",
  ".rd-pop-bar button.hl-yellow{",
  ".rd-pop-bar button.hl-green{",
  ".rd-pop-bar button.hl-pink{",
  ".rd-pop-bar button.rd-hlbtn:hover{",
]) s.includes(r) ? ok(r) : ng("缺规则 " + r);

console.log("\n[2] 浮条 JSX 仍有三色高亮按钮（修复对应真实控件）");
for (const j of ['addHighlight("yellow")', 'addHighlight("green")', 'addHighlight("pink")'])
  s.includes(j) ? ok(j) : ng("缺浮条按钮 " + j);
s.includes('className="rd-pop-bar"') ? ok("浮条容器 .rd-pop-bar 存在") : ng("缺 .rd-pop-bar 容器");
/\.rd-pop-bar\{[^}]*align-items:center/.test(s) ? ok("浮条 align-items:center（色块垂直居中）") : ng("缺 .rd-pop-bar align-items:center");

console.log("\n[3] 文件结构未破");
(c("{") === c("}")) ? ok("花括号平衡") : ng("花括号失衡 " + c("{") + "/" + c("}"));
(c("`") % 2 === 0) ? ok("反引号偶数") : ng("反引号奇数");

console.log("\n[4] 范围/红线：纯 CSS 修复，不新增引擎/IPC/盗版");
// 本补丁只动 Reader.jsx 内嵌 <style>，不应引入这些（防御性自检）
const addedBad = /sci-?hub|libgen|anna'?s? archive/i.test(s.split("\n").filter((l)=>l.includes("rd-pop-bar button.hl")||l.includes("rd-pop-bar button.rd-hlbtn")).join("\n"));
addedBad ? ng("修复行内含盗版词（不应出现）") : ok("修复行无盗版词");

console.log(`\n=== verify: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
