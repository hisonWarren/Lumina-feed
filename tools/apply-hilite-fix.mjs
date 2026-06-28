#!/usr/bin/env node
// apply-hilite-fix.mjs — 安全、幂等地修复划词浮条三色高亮按钮不可见（CSS 特异性碰撞）。
// 做法：不整包复制 Reader.jsx；在其内嵌 <style> 里、紧跟既有 .rd-hlbtn 规则后，插入 5 条更高特异性规则。
// 特性：定位锚点须唯一 → 先备份 → 幂等(已修则跳过) → 写入后校验花括号/反引号平衡未破。
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] || ".";
const FILE = join(ROOT, "src/ui/modules/Reader.jsx");

const ANCHOR = ".rd-hlbtn{width:18px;height:18px;border:1px solid rgba(255,255,255,.5);border-radius:5px;cursor:pointer;padding:0}";
const MARKER = ".rd-pop-bar button.hl-yellow";   // 幂等标记
const INSERT = [
  "",
  ".rd-pop-bar button.rd-hlbtn{padding:0;border:1px solid rgba(255,255,255,.65)}",
  ".rd-pop-bar button.hl-yellow{background:rgba(245,210,70,.95)}",
  ".rd-pop-bar button.hl-green{background:rgba(120,220,120,.95)}",
  ".rd-pop-bar button.hl-pink{background:rgba(255,150,180,.95)}",
  ".rd-pop-bar button.rd-hlbtn:hover{box-shadow:0 0 0 2px rgba(255,255,255,.45)}",
].join("\n");

const die = (m) => { console.error("✗ " + m); process.exit(1); };
const bal = (s) => {
  const c = (ch) => (s.match(new RegExp("\\" + ch, "g")) || []).length;
  return c("{") === c("}") && c("(") === c(")") && c("[") === c("]") && (c("`") % 2 === 0);
};

if (!existsSync(FILE)) die("找不到 " + FILE + "（请把 ROOT 指向 lumina-feed 仓库根：node apply-hilite-fix.mjs <repo>）");
let src = readFileSync(FILE, "utf8");

if (src.includes(MARKER)) { console.log("• 已应用过（检测到 " + MARKER + "）——跳过，未改动。"); process.exit(0); }

const occ = src.split(ANCHOR).length - 1;
if (occ === 0) die("定位锚点未找到（.rd-hlbtn 规则）。可能 Reader.jsx 版本不符，请人工核对后插入 5 条规则。");
if (occ > 1) die("定位锚点出现 " + occ + " 次，非唯一，已中止以免误改。请人工处理。");

copyFileSync(FILE, FILE + ".bak");
const out = src.replace(ANCHOR, ANCHOR + INSERT);
if (!bal(out)) die("插入后花括号/反引号失衡，已中止（未写入）。备份在 " + FILE + ".bak");
writeFileSync(FILE, out, "utf8");
console.log("✓ 已插入 5 条高特异性规则（备份：Reader.jsx.bak）。三色高亮按钮将可见。");
console.log("  下一步：node tools/verify-lumina-reader-hilite-fix.mjs " + ROOT + " ；并在真机查看浮条。");
