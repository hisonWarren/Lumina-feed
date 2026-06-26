#!/usr/bin/env node
// synra_patch_lumina_ux · verify
//   node tools/verify-lumina-ux.mjs <target>   （默认 .）
// 对「已应用的目标仓库」做结构断言(5 问题修复) + UX-F 交互流畅性。
// React/JSX 无法在无 npm 沙箱执行 → 仅结构断言；视觉/交互需浏览器验收(见 EXIT_CRITERIA)。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = process.argv[2] || ".";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };
const read = (p) => { try { return readFileSync(join(TARGET, p), "utf8"); } catch { return ""; } };
const has = (s, ...subs) => subs.every((x) => s.includes(x));

const themes = read("src/ui/themes.js");
const obs = read("src/ui/Observatory.jsx");
const ux = read("src/ui/lumina-ux.jsx");
const main = read("electron/main.ts");
const preload = read("electron/preload.ts");

// ───────── issue4 · 主题系统 + 默认亮色 ─────────
console.log("— issue4 · 多主题 + 默认亮色 —");
ok(themes && has(themes, "export const THEMES", "export const DEFAULT_THEME"), "themes.js 导出 THEMES + DEFAULT_THEME");
{
  const ids = [...themes.matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
  ok(ids.length >= 4, `主题数 ≥4（实得 ${ids.length}：${ids.join("/")}）`);
  const def = (themes.match(/DEFAULT_THEME\s*=\s*"([a-z]+)"/) || [])[1];
  const defLine = themes.split("\n").find((l) => l.includes(`id: "${def}"`)) || "";
  ok(/base:\s*"day"/.test(defLine), `默认主题「${def}」是亮色(base:day)`);
  const lightCount = (themes.match(/base:\s*"day"/g) || []).length, darkCount = (themes.match(/base:\s*"night"/g) || []).length;
  ok(lightCount >= 2 && darkCount >= 2, `亮/暗各≥2（亮${lightCount}/暗${darkCount}）`);
}
ok(has(obs, 'import { THEMES, THEME_CSS, DEFAULT_THEME', './themes.js'), "Observatory 引入主题模块");
ok(has(obs, "data-theme={themeId}"), "根元素挂 data-theme");
ok(has(obs, "useState(DEFAULT_THEME)"), "主题状态默认 = DEFAULT_THEME(亮色)");
ok(has(ux, "ThemePicker") && has(ux, "lux-theme-pop"), "ThemePicker 主题选择器存在");

// ───────── issue1 + issue3 · 自定义订阅 + 推送入口 ─────────
console.log("— issue1+3 · 自定义订阅 + 可见推送入口 —");
ok(has(ux, "export function SubscriptionManager"), "订阅管理器组件存在");
ok(has(ux, "export function emptySub") && has(ux, "query", "sources", "freq", "channels"), "订阅模型含 检索式/源/频率/渠道");
ok(has(ux, "新建订阅"), "「新建订阅」入口文案存在");
ok(has(ux, "推送频率") && has(ux, "推送渠道"), "推送排程 + 渠道配置存在");
ok(has(ux, "export function SubscribeEntry"), "头部「订阅/推送」入口组件存在");
ok(has(obs, "<SubscribeEntry") && has(obs, "setSubMgr(true)"), "头部挂载订阅入口并可打开管理器");
ok(has(obs, "<SubscriptionManager") && has(obs, "onSave=") && has(obs, "onDelete="), "管理器挂载且可增/删/改");
ok(has(obs, "const [subs, setSubs] = useState(SUBS)"), "订阅由状态驱动(可自定义,非写死)");
ok(has(obs, "subs={subs}") , "今日推送视图按用户订阅渲染");

// ───────── issue2 · 文献检索 → 获取全文入口（主操作） ─────────
console.log("— issue2 · 获取全文主操作入口 —");
ok(has(obs, "lf-act-ft") && has(obs, "获取全文"), "卡片「获取全文」设为主操作(lf-act-ft)");
ok(has(ux, ".lf-act.lf-act-ft{background:var(--gold)"), "取全文主操作填充强调色(突出)");

// ───────── issue5 · 无边框 + 去原生菜单 + 自定义标题栏 ─────────
console.log("— issue5 · 无边框窗口 + 去 Windows 菜单 + 自定义标题栏 —");
ok(has(main, "frame: false"), "BrowserWindow frame:false(无原生边框)");
ok(has(main, "autoHideMenuBar: true"), "autoHideMenuBar:true");
ok(has(main, "win.removeMenu()"), "removeMenu() 移除窗口菜单");
ok(has(main, "Menu.setApplicationMenu(null)"), "移除应用级菜单(File/Edit/View/Window/Help)");
ok(has(main, 'ipcMain.handle("win:minimize"', 'ipcMain.handle("win:maximize"', 'ipcMain.handle("win:close"'), "窗口控制 IPC(最小化/最大化/关闭)");
ok(has(preload, "luminaWin") && has(preload, "minimize", "maximize", "close"), "preload 暴露 luminaWin 窗口控制");
ok(has(ux, "export function TitleBar") && has(ux, "lux-titlebar") && has(ux, "-webkit-app-region:drag"), "自定义标题栏(可拖拽)存在");
ok(has(obs, "<TitleBar"), "Observatory 顶部挂载 TitleBar");

// ───────── UX-F · 交互流畅性(§3.4) —— 代码项 ─────────
console.log("— UX-F 交互流畅性(代码项) —");
ok(has(obs, 'pushToast("订阅已保存"') && has(obs, 'pushToast("订阅已删除")'), "F1 双反馈:订阅增删有 toast 反馈");
ok(has(obs, "获取中…") && has(obs, "lf-act-ft") && has(obs, "loading"), "F1 双反馈:取全文有 loading 态");
ok(has(ux, "lux-empty") && has(ux, "还没有订阅"), "F2 非静默:空订阅列表有引导文案");
ok(has(ux, "disabled={!editing.name.trim()}"), "F2 非静默:无名订阅禁用保存(不静默 return)");
ok(has(ux, "lux-modal-scrim") && has(ux, "place-items:center"), "F3 浮层:管理器居中模态,不抢右下角 toast");
ok(has(ux, "z-index:120") && has(ux, "z-index:60"), "F3 浮层:标题栏/模态 z-index 分层不冲突");

// ───────── UX-F · 文档项（ROLE_EVALUATION，相对本包） ─────────
console.log("— UX-F 交互流畅性(文档项) —");
const reP = join(HERE, "..", "00_analysis", "ROLE_EVALUATION.md");
const re = existsSync(reP) ? readFileSync(reP, "utf8") : "";
ok(re && has(re, "反馈策略"), "F5 ROLE_EVALUATION 含「反馈策略」小节");
ok(re && (has(re, "§0 交互流") || has(re, "交互流表")), "F6 ROLE_EVALUATION 含 §0 交互流表");
ok(re && has(re, "Pre-mortem") && has(re, "静默") && has(re, "浮层"), "F8 Pre-mortem 含 浮层/静默 等项");

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
