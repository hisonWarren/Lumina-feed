#!/usr/bin/env node
// verify-lumina-results-paging.mjs — structure-level (no network/visual).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASES = [join(ROOT, "files"), ROOT];
const F = (p) => {
  for (const b of BASES) {
    const full = join(b, p);
    if (existsSync(full)) return full;
  }
  return join(ROOT, p);
};
let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✓ " + m); pass++; };
const ng = (m) => { console.log("  ✗ " + m); fail++; };
const read = (p) => readFileSync(p, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const cc = (s, c) => (s.match(new RegExp("\\" + c, "g")) || []).length;

const FILES = ["src/ui/lib/paginate.js", "src/ui/components/ResultsPager.jsx", "src/ui/styles/results-paging.css"];
console.log("\n[1] 文件存在");
for (const p of FILES) existsSync(F(p)) ? ok(p) : ng("缺 " + p);
for (const t of ["tools/test-paginate.mjs"]) existsSync(join(ROOT, t)) ? ok(t) : ng("缺 " + t);

console.log("\n[2] 括号/反引号平衡");
for (const p of FILES) {
  let s = read(F(p));
  const bal = (x) => cc(x, "{") === cc(x, "}") && cc(x, "(") === cc(x, ")") && cc(x, "[") === cc(x, "]");
  (bal(s) || bal(strip(s))) ? ok("括号 " + p) : ng("括号不平衡 " + p);
  if (/\.(js|jsx)$/.test(p)) (cc(s, "`") % 2 === 0) ? ok("反引号偶数 " + p) : ng("反引号奇数 " + p);
}

console.log("\n[3] 契约名（presence）");
const has = (p, re, n) => (re.test(read(F(p))) ? ok(n) : ng(n + " 缺于 " + p));
for (const fn of ["pageCount", "clampPage", "pageSlice", "rangeLabel", "pageWindow"]) has("src/ui/lib/paginate.js", new RegExp("export function " + fn), "paginate: " + fn);
has("src/ui/components/ResultsPager.jsx", /本次检索/, "Pager: 诚实计数文案『本次检索』");
has("src/ui/components/ResultsPager.jsx", /aria-current/, "Pager: aria-current 无障碍");
has("src/ui/components/ResultsPager.jsx", /缩小/, "Pager: 缩小检索引导");
has("src/ui/components/ResultsPager.jsx", /pageWindow/, "Pager: 用 pageWindow 紧凑页码");
has("src/ui/components/ResultsPager.jsx", /onPageSize/, "Pager: 每页选择器");
has("src/ui/styles/results-paging.css", /\.lf-pager/, "css .lf-pager");
has("src/ui/styles/results-paging.css", /\.lf-pg\.num\.on/, "css 选中页 .lf-pg.num.on（实心 petrol）");

console.log("\n[4] 范围护栏（absence，剥注释后判定）");
const lacks = (p, re, n) => (re.test(strip(read(F(p)))) ? ng(n + " 命中于 " + p) : ok(n));
// 组件不得调用引擎/重新联网（= 无跨源深翻深分页）
lacks("src/ui/components/ResultsPager.jsx", /searchOnline|bridge\.|fetch\s*\(/, "Pager 纯客户端：无引擎再调用/重新联网");
// 助手纯函数：无网络
lacks("src/ui/lib/paginate.js", /searchOnline|fetch\s*\(|XMLHttpRequest/, "paginate 纯函数：无网络");
// 无盗版词（防御性）
for (const p of FILES) if (/sci-?hub|libgen|anna'?s? archive/i.test(strip(read(F(p))))) ng("盗版词 " + p);
ok("files 内无盗版词");

console.log(`\n=== verify: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
