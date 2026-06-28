#!/usr/bin/env node
// verify-lumina-shell-polish — 结构级校验：顶栏全宽满铺 + 四模块深度 polish + groundedRatio 多语言 hotfix。
// 沙箱只验结构（存在/平衡/契约/落点），视觉与端到端须真机（见 README 待真机清单）。
import fs from "node:fs";
import { execSync } from "node:child_process";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + m); } };
const read = (p) => fs.readFileSync(p, "utf8");

// 括号/反引号平衡（去注释/字符串/模板后）
function balanced(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
  const pairs = { "}": "{", ")": "(", "]": "[" };
  const open = new Set(["{", "(", "["]); const st = [];
  for (const ch of s) { if (open.has(ch)) st.push(ch); else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; } }
  return st.length === 0;
}

const idx = read("renderer/index.html");
const lf = read("src/ui/LuminaApp.jsx");
const rai = read("src/core/reader/reader-ai.ts");
const lib = read("src/ui/modules/Library.jsx");
const rh = read("src/ui/modules/ReadHub.jsx");
const subs = read("src/ui/modules/Subscriptions.jsx");

console.log("— 壳层全宽 / 满铺 —");
ok(/#root\s*\{[^}]*padding:\s*0/.test(idx), "index.html #root 满铺 padding:0（去浮动白框）");
ok(!/#root\s*\{[^}]*padding:\s*12px/.test(idx), "index.html 不再有 12px 旧边框");
ok(/height:100vh;width:100%;display:flex/.test(lf), ".lf 加 width:100%（根因修复：顶栏逐页宽度一致）");
ok(/\.lf button:focus-visible[^}]*outline:2px solid var\(--gold-line\)/.test(lf), "全局 a11y 焦点环（button/input/tab/menuitemradio）");
ok(/@media \(prefers-reduced-motion: reduce\)/.test(lf), "保留 reduced-motion");

console.log("— FindFetch 收敛 + 卡片 polish —");
// 958 = card border-box (920 content + 18×2 padding + 1×2 border); ff-head content edge now sits at the card's left/right border edge
ok(/\.ff-head\{[^}]*max-width:958px;margin:0 auto/.test(lf), ".ff-head 满宽时收敛居中（不散）· 958 对齐卡片列宽");
ok(/\.ff-card\{[^}]*max-width:920px[^}]*transition:box-shadow/.test(lf), ".ff-card 收敛 + 过渡");
ok(/\.ff-card:hover\{[^}]*box-shadow:var\(--shadow\)/.test(lf), ".ff-card:hover 抬升");

console.log("— Library / ReadHub / Subscriptions 深度 polish —");
ok(/\.lib-card\{[^}]*transition:box-shadow/.test(lib) && /\.lib-card:hover\{[^}]*box-shadow:var\(--shadow\)/.test(lib), "Library 卡片 hover 抬升");
ok(/\.rh-drop:hover\{[^}]*box-shadow:var\(--shadow\)/.test(rh), "ReadHub 拖拽区 hover 阴影");
ok(/\.rh-btn\{[^}]*linear-gradient\(135deg,var\(--gold\),var\(--goldDim\)\)/.test(rh) && /\.rh-btn:hover\{[^}]*translateY\(-1px\)/.test(rh), "ReadHub 主按钮渐变 + hover");
ok(/\.subs-btn\.primary\{[^}]*linear-gradient\(135deg,var\(--gold\),var\(--goldDim\)\)/.test(subs), "Subscriptions 主按钮渐变");

console.log("— groundedRatio 多语言 hotfix（reader-ai.ts）—");
ok(/function multiTokens\(s: string\): \{ anchors: string\[\]; cjk: string\[\] \}/.test(rai), "multiTokens（锚点 + CJK bigram）已定义");
ok(!/function contentTokens\(/.test(rai), "旧 contentTokens 已移除（中文无空格巨型 token 根因）");
ok(/\[\\u3400-\\u9FFF\]\+/.test(rai), "CJK 段内 bigram（同语言信号）");
ok(/\[a-z\]\[a-z0-9\+\\-\]\{2,\}/.test(rai), "拉丁词锚点（≥3，跨语言专名/缩写）");
ok(/anchors\.length >= 1 && aCov >= hi\) \|\| cCov >= hi/.test(rai), "判据：锚点过半命中 OR CJK bigram 过半命中");
ok(/\.replace\(\/\\\*\\\*\/g, ""\)\.replace\(\/\^\[\\s>#\*\\-\\d\.、\]\+\//.test(rai), "splitClaims 清理 Markdown 列表/加粗标记");
ok(!/buildGroundedSummary/.test(rai), "不复活通用 buildGroundedSummary（阅读器专用接地）");
ok((rai.match(/groundReaderAnswer\(answer, (picked|pages)\)/g) || []).length === 2, "两处调用点（picked/pages）保留");
ok(/sourceBasis: "fulltext"/.test(rai) || /sourceBasis:"fulltext"/.test(rai), "红线4：sourceBasis 仍在");

console.log("— 平衡 / TS —");
for (const [p, src] of [["LuminaApp.jsx", lf], ["Library.jsx", lib], ["ReadHub.jsx", rh], ["Subscriptions.jsx", subs]])
  ok(balanced(src), p + " 括号/反引号平衡");
try { execSync("node --experimental-strip-types --check src/core/reader/reader-ai.ts", { stdio: "pipe" }); ok(true, "reader-ai.ts TS"); }
catch { ok(false, "reader-ai.ts TS 语法"); }

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
