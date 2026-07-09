#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
function jsxSyntaxCheck(p) {
  try { execSync(`node tools/jsx-syntax-check.mjs ${p}`, { stdio: "pipe", cwd: process.cwd() }); return true; }
  catch { return false; }
}
console.log("── shell_redesign（P-shell① 顶栏 + 深度 token）契约自检 ──");
const app = R("src/ui/LuminaApp.jsx"), logo = R("src/ui/brand-logo.js");
ok(jsxSyntaxCheck("src/ui/LuminaApp.jsx"), "LuminaApp.jsx 语法（jsx-syntax-check）");
try { execSync("node --check src/ui/brand-logo.js", { stdio: "pipe" }); ok(true, "brand-logo.js node --check"); } catch { ok(false, "brand-logo.js node --check"); }
ok(/export const LOGO_DATA_URI = "data:image\/png;base64,/.test(logo) && logo.length > 4000, "brand-logo 导出真 logo data URI");
ok(/--shadow:0 1px 2px/.test(app) && /--shadow-lg:/.test(app) && /--raise:#fff/.test(app) && /--r:13px/.test(app), "深度 token：--shadow/--shadow-lg/--raise/--r 入 .lf 基底");
ok(/--gold-tint:color-mix\(in srgb,var\(--gold\) 10%/.test(app) && /--gold-line:color-mix\(in srgb,var\(--gold\) 28%/.test(app), "tint/line 用 color-mix 随主题强调色自适应");
ok(/--amber:#BE7A18/.test(app) && /--ok:#2C8A60/.test(app), "语义色 --amber/--ok 补齐");
ok(/<img className="lf-logo" src=\{LOGO_DATA_URI\}/.test(app), "顶栏用真 logo（lf-logo img）");
ok(/lf-wm[^]*Locate · Fetch · Illuminate/.test(app), "词标 + tagline（签名）");
ok(/\.lf-nav\{[^}]*margin:0 auto[^}]*border-radius:12px/.test(app), "导航改居中分段药丸");
ok(/role="tablist"/.test(app) && /role="tab" aria-selected/.test(app), "导航 ARIA：tablist/tab + aria-selected");
ok(/subsNew > 0 && <span className="lf-badge">/.test(app) && /lib\.length > 0 && <span className="lf-badge">/.test(app), "订阅未读 + 库计数 徽标");
ok(/await bridge\.subsList\(\)/.test(app) || /typeof bridge\.subsList === "function"/.test(app), "订阅计数走 bridge.subsList");
ok(/lf-status[^]*lf-dot[^]*本机 · 已就绪/.test(app), "状态药丸「本机·已就绪」+ 发光点");
ok(/THEMES\.map\(\(t\)/.test(app) && /lf-sw[^]*t\.swatch/.test(app) && /onTheme\(t\.id\)/.test(app), "顶栏主题色板菜单（复用 onTheme）");
ok(/role="menuitemradio" aria-checked=\{theme === t\.id\}/.test(app), "主题菜单 ARIA");
ok(/import \{ DEFAULT_THEME, THEME_CSS, isLight, THEMES/.test(app) && /Palette/.test(app) && /LOGO_DATA_URI/.test(app), "导入：THEMES/Palette/Check/LOGO_DATA_URI");
ok(/<FindFetch/.test(app) && /<Subscriptions/.test(app) && /<ReaderModule/.test(app) && /<Library/.test(app) && /<Settings/.test(app), "五模块渲染不变（无回归）");
ok(/const onTheme = useCallback/.test(app), "复用既有 onTheme");
ok(/@media \(prefers-reduced-motion: reduce\)\{ \.lf-tab\{transition:none\}/.test(app), "tab 过渡尊重 reduced-motion");
ok(!/&&\s*(FindFetch|Subscriptions|ReaderModule|Library|Settings)\(/.test(app), "无危险 Hook 条件调用");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
