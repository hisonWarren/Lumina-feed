#!/usr/bin/env node
// 结构验证：主题化中文右键菜单（渲染层 AppContextMenu + IPC 转发）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, x) => typeof s === "string" && s.includes(x);

const main = read("electron/main.ts");
const ctx = read("electron/context-menu.ts");
const pre = read("electron/preload.ts");
const app = read("src/ui/LuminaApp.jsx");
const menu = read("src/ui/components/AppContextMenu.jsx");

console.log("\n[1] 主进程 · IPC 转发（非原生英文 Menu.popup）");
ok(has(ctx, "CONTEXT_MENU_CHANNEL") && has(ctx, "installContextMenuBridge"), "context-menu 模块");
ok(has(main, "installContextMenuBridge") && has(main, "lumina:context-action"), "main 接线");
ok(has(main, 'label: "编辑"') && has(main, 'label: "撤销"'), "隐藏菜单栏中文标签（快捷键保留）");
ok(!has(main, "Menu.buildFromTemplate(tpl).popup"), "已移除原生右键 popup");

console.log("\n[2] preload · 暴露");
ok(has(pre, "onContextMenu") && has(pre, "lumina:context-menu"), "onContextMenu 监听");
ok(has(pre, "contextAction") && has(pre, "lumina:context-action"), "contextAction 执行");
ok(has(pre, "platform: process.platform"), "platform 供快捷键显示");

console.log("\n[3] 渲染层 · 主题化菜单");
ok(has(menu, "AppContextMenu") && has(menu, "lf-ctx"), "AppContextMenu 组件");
ok(has(menu, "撤销") && has(menu, "复制") && has(menu, "粘贴") && has(menu, "全选"), "中文标签");
ok(has(menu, "Undo2") && has(menu, "Copy") && has(menu, "ClipboardPaste"), "Lucide 图标");
ok(has(menu, "var(--raise)") && has(menu, "var(--shadow-lg)"), "复用 Lumina 主题 token");
ok(has(app, "AppContextMenu") && has(app, "onContextMenu"), "LuminaApp 挂载");

try { execSync("node --experimental-strip-types --check electron/context-menu.ts", { stdio: "pipe" }); ok(true, "context-menu.ts strip-types"); } catch { ok(false, "context-menu.ts strip-types"); }

console.log("\n──────────────────────────────");
console.log(`context_menu 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：输入框右键中文+图标 · 快捷键仍可用 · 暗色主题下对比度 · 窄窗不裁切");
process.exit(fail ? 1 : 0);
