#!/usr/bin/env node
import { execSync } from "node:child_process";
function jsxSyntaxCheck(p) {
  try { execSync(`node tools/jsx-syntax-check.mjs ${p}`, { stdio: "pipe", cwd: process.cwd() }); return true; }
  catch { return false; }
}
// 结构验证：finish（结果页引用复制 + 真暗色 surface + 缩略图虚拟化 + 主题菜单/检索框 Esc）。
// 构建于 provider_translate + reader_nav_find + polish_persist 之上。
// 仅结构级——暗色对比/观感、虚拟化性能、Esc/外点交互均须真机。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);
function balanced(src) {
  if (typeof src !== "string") return false;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
  s = s.replace(/\/\/[^\n]*/g, " ");
  const pairs = { "}": "{", ")": "(", "]": "[" }, open = new Set(["{", "(", "["]), st = [];
  for (const ch of s) { if (open.has(ch)) st.push(ch); else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; } }
  return st.length === 0;
}

const ff = read("src/ui/modules/FindFetch.jsx");
const themes = read("src/ui/themes.js");
const reader = read("src/ui/modules/Reader.jsx");
const app = read("src/ui/LuminaApp.jsx");

console.log("\n[1] 结果页引用（cite.js 复制 + finish_all 下载 .ris/.bib）");
const cite = read("src/ui/components/CitationActions.jsx") || "";
const citeViaComponent = has(ff, "CitationActions") && has(cite, 'from "../cite.js"');
ok(citeViaComponent || has(ff, 'import { STYLES, formatCitation } from "../cite.js"'), "复用 cite.js（STYLES/formatCitation）");
ok(citeViaComponent || has(ff, "const [citeFor, setCiteFor]"), "citeFor 状态（或 CitationActions 组件）");
ok(citeViaComponent || (has(ff, "const copyCite = (style, p)") && has(ff, "navigator.clipboard")), "copyCite / CitationActions 复制");
ok(has(ff, '.ff-cites{') && has(ff, '.ff-cite{') || has(cite, "lf-cite-menu"), "引用菜单 CSS");
ok(citeViaComponent || (has(ff, "<Quote size={13} /> 引用") && has(ff, "STYLES.map((st)")), "引用按钮 + 五样式展开");
ok(citeViaComponent || has(ff, '<button key={st[0]} className="ff-cite"'), "逐样式按钮（或 CitationActions）");

console.log("\n[2] 真暗色 surface（night 主题 .lf:not(.day) token，此前缺）");
ok(has(themes, ':not(.day){--surf:'), "night 主题暗表面 token");
ok(has(themes, "color-mix(in srgb,") && has(themes, "deep"), "由 swatch 深色派生 surf2/raise");
ok(has(themes, "--ink:#ECEEF3") && has(themes, "--line:rgba(255,255,255,"), "暗色文字/描边 token");
ok(has(themes, 'const base = `.lf[data-theme='), "品牌色 base 部分保留（不破坏既有 THEME_CSS）");
ok(has(themes, 'if (t.base !== "night") return base;'), "仅 night 主题加暗表面，day 主题不变");

console.log("\n[3] 缩略图虚拟化（IntersectionObserver · 可见才渲 · sticky）");
ok(has(reader, "const [show, setShow] = useState(false)") && has(reader, "new IntersectionObserver"), "IntersectionObserver 可见门控");
ok(has(reader, "io.disconnect(); break;") || has(reader, "setShow(true); io.disconnect();"), "命中即渲并断开（sticky，不重复）");
ok(/rootMargin:/.test(reader), "预渲染余量 rootMargin");
ok(has(reader, '.rd-thumb-c{') && has(reader, "min-height:150px"), "占位高度（保证滚动高度/IO 正确）");
ok(has(reader, 'typeof IntersectionObserver === "undefined"'), "无 IO 环境降级（直接渲）");

console.log("\n[4] Esc 收口（主题菜单 + 检索框）");
ok(has(app, "if (!themeOpen) return;") && has(app, 'e.key === "Escape"') && has(app, 'closest(".lf-theme-wrap")'), "主题菜单 Esc + 外点关闭");
ok(has(ff, 'else if (e.key === "Escape") clear();'), "检索框 Esc 清除");

console.log("\n[5] 链路完整性（前置补丁未回退）");
ok(has(ff, "function sortResults") && (has(ff, "pageItems.map") || has(ff, "shown.map")), "reader_nav_find 结果排序仍在");
ok(has(ff, "filters.yearFrom"), "reader_nav_find 年份约束仍在");
ok(has(reader, ".rd-rail") && has(reader, "startResize"), "reader_nav_find 侧栏仍在");
ok(has(reader, "bridge.getNavmarks(docKey)") && has(reader, "bridge.saveNavmarks(docKey, next)"), "polish_persist 书签持久化仍在");
ok(has(reader, ".rd-trwrap") && has(reader, "pmapRef"), "provider_translate 译菜单/缓存仍在");
ok(has(app, "@media (prefers-reduced-motion: reduce){ *,*::before,*::after{"), "polish_persist 全局 reduced-motion 仍在");

console.log("\n[6] 括号平衡");
ok(typeof ff === "string" && ff.includes("export default"), "FindFetch.jsx 存在（JSX 语法由 esbuild 构建验证）");
ok(balanced(themes), "themes.js 平衡");
ok(balanced(reader), "Reader.jsx 平衡");
ok(jsxSyntaxCheck("src/ui/LuminaApp.jsx"), "LuminaApp.jsx 语法（jsx-syntax-check）");

console.log("\n──────────────────────────────");
console.log(`finish 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：结果页复制各式引用 / 三暗色主题(暖夜/薄暮/松林)逐页对比度与观感 / 大 PDF 缩略图虚拟化是否顺滑 / 主题菜单·检索框 Esc / 6 主题");
process.exit(fail ? 1 : 0);
