#!/usr/bin/env node
import { execSync } from "node:child_process";
function jsxSyntaxCheck(p) {
  try { execSync(`node tools/jsx-syntax-check.mjs ${p}`, { stdio: "pipe", cwd: process.cwd() }); return true; }
  catch { return false; }
}
// 结构验证：multidoc_open（多标签阅读 A2 + 本地 PDF 右键/命令行打开 B2）。
// 构建于 finish 链之上。A2 可结构验证；B2 的 OS 文件关联/打包属真机（fileAssociations 见 DESIGN_NOTES，须接入 electron-builder）。
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

const hub = read("src/ui/modules/ReadHub.jsx");
const app = read("src/ui/LuminaApp.jsx");
const main = read("electron/main.ts");
const preload = read("electron/preload.ts");
const bridge = read("src/ui/lumina-bridge.js");

console.log("\n[1] 多标签阅读（A2 · 已挂载隐藏 · 仅活跃可见 · 无硬上限 + 右键菜单）");
ok(has(hub, "const RHX_CSS = `") && has(hub, ".rhx-tabs{") && has(hub, ".rhx-pane{"), "标签条 CSS（RHX_CSS）");
ok(has(hub, "useState({ tabs: [], activeId: null })"), "单一状态 {tabs, activeId}（原子更新）");
ok(!has(hub, "const MAX_TABS = 6") && has(hub, "TAB_SOFT_WARN") && has(hub, "关闭其他标签页"), "取消硬上限 6；软提示 + 右键批量关闭");
ok(has(hub, "closeLeft") && has(hub, "closeRight") && has(hub, "onContextMenu"), "右键：关闭左侧/右侧");
ok(has(hub, "tabs-dense") && has(hub, "tabs-crowded"), "多标签自动收缩密度");
ok(has(hub, "const closeTab = useCallback") && has(hub, "rhx-tab-x"), "关闭标签");
ok(has(hub, 'role="tablist"') && has(hub, '<Home size={14} />') && has(hub, "rhx-tab-nm"), "标签条 JSX（首页 + 各标签）");
ok(has(hub, 'style={{ display: t.id === st.activeId ? "flex" : "none" }}'), "非活跃标签 display:none（已挂载隐藏，保留各自状态）");
ok(/<Reader[\s\S]{0,200}source=\{t\}[\s\S]{0,200}onClose=\{\(\) => closeTab\(t\.id\)\}/.test(hub), "每标签独立 Reader（单篇，无跨标签 AI）");
ok(has(hub, "const tabKey = (t)") && has(hub, "found.id"), "去重：同篇已开则激活不重开");

console.log("\n[2] 本地 PDF 打开（B2 · 主进程 · 渲染层接入）");
ok(has(main, "app.requestSingleInstanceLock()"), "单实例锁");
ok(has(main, 'app.on("second-instance"') && has(main, "pdfFromArgv"), "second-instance（win/linux argv）");
ok(has(main, 'app.on("open-file"'), "open-file（macOS）");
ok(has(main, "async function sendOpenPdf") && has(main, 'webContents.send("open-local-pdf"') && has(main, "readFile"), "读取文件 → 发 open-local-pdf");
ok(has(main, "coldOpenPdfPath") && has(main, "app:pullPendingOpenPdf"), "冷启动 pull 待打开 PDF（避免首屏丢事件）");
ok(has(main, "if (!gotLock) return;"), "非主实例不重复初始化");
ok(has(preload, 'onOpenLocalPdf:') && has(preload, 'ipcRenderer.on("open-local-pdf"'), "preload 暴露 onOpenLocalPdf");
ok(has(preload, "pullPendingOpenPdf"), "preload pullPendingOpenPdf");
ok(has(bridge, "onOpenLocalPdf(cb)") && has(bridge, "!api.onOpenLocalPdf"), "bridge 防御式 onOpenLocalPdf（无后端 no-op）");
ok(has(bridge, "pullPendingOpenPdf") && has(app, "pullPendingOpenPdf"), "LuminaApp 冷启动 pull + 监听打开事件");
ok(has(app, 'setMode("read")') && has(app, "incoming={incomingPdf}") && has(app, "onIncomingHandled"), "切到阅读 + 传入 ReaderModule 开标签");

console.log("\n[3] 链路完整性（前置未回退）");
ok(has(hub, 'import Reader from "./Reader.jsx"') && has(hub, "onOpenDownloaded"), "ReadHub 落地页/已下载仍在");
ok(has(app, 'closest(".lf-theme-wrap")'), "finish 主题菜单 Esc 仍在");
ok(has(app, "@media (prefers-reduced-motion: reduce){ *,*::before,*::after{"), "polish_persist 全局 reduced-motion 仍在");

console.log("\n[4] 括号平衡（JS/JSX；.ts 由 node --experimental-strip-types --check 权威校验，朴素计数器不剥离正则字面量故不用于 .ts）");
ok(balanced(hub), "ReadHub.jsx 平衡");
ok(jsxSyntaxCheck("src/ui/LuminaApp.jsx"), "LuminaApp.jsx 语法（jsx-syntax-check）");
ok(balanced(bridge), "lumina-bridge.js 平衡");
ok(typeof main === "string" && main.length > 0, "main.ts 存在（语法见 strip-types）");
ok(typeof preload === "string" && preload.length > 0, "preload.ts 存在（语法见 strip-types）");

console.log("\n──────────────────────────────");
console.log(`multidoc_open 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：多标签切换/关闭/上限·各标签独立状态·内存 / 右键或命令行打开 PDF（需接入 electron-builder fileAssociations）/ macOS open-file / 单实例 / 6 主题");
process.exit(fail ? 1 : 0);
