#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const reader = read("src/ui/modules/Reader.jsx");
const menu = read("src/ui/components/ReaderContextMenu.jsx");
const ctx = read("electron/context-menu.ts");
const app = read("src/ui/LuminaApp.jsx");

console.log("\n[1] ReaderContextMenu 组件");
ok(menu && menu.includes("ReaderContextMenu"), "组件存在");
ok(menu && menu.includes("顺时针旋转") && menu.includes("逆时针旋转"), "旋转双向");
ok(menu && menu.includes("复制带页码引用") && menu.includes("高亮 · 黄"), "选区菜单项");

console.log("\n[2] Reader 集成");
ok(reader && reader.includes("onReaderContextMenu"), "contextmenu 处理器");
ok(reader && reader.includes("ReaderContextMenu"), "挂载菜单");
ok(reader && reader.includes("RotateCcw"), "工具栏逆时针旋转");
ok(reader && reader.includes("setReaderContextHost"), "阅读器接管全局菜单");
ok(reader && !reader.includes("批注 · P3"), "已移除内部代号 P3");
ok(reader && reader.includes("条批注"), "用户可读批注状态");

console.log("\n[3] 共享与主进程");
ok(read("src/ui/reader-selection.js")?.includes("captureTextSelection"), "选区捕获共用");
ok(read("src/ui/reader-context-host.js")?.includes("isReaderContextHost"), "host 标记");
ok(app && app.includes("isReaderContextHost"), "LuminaApp 抑制重复菜单");
ok(ctx && ctx.includes('case "print"'), "打印动作");

console.log(`\nreader_context_menu：${pass}/${pass + fail}` + (fail ? " 失败" : " 全绿"));
process.exit(fail ? 1 : 0);
