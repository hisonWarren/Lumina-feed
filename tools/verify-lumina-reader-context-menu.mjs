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
ok(menu && menu.includes("上一页") && menu.includes("页内查找"), "空白区核心项（翻页·查找）");
ok(menu && !menu.includes("适配宽度") && !menu.includes("夜读反色"), "空白区已移除顶栏重复项（缩放·显示模式）");
ok(menu && menu.includes("复制带页码引用") && menu.includes("高亮 · 黄"), "选区菜单项");
ok(menu && menu.includes("tpCopy") && menu.includes("复制本页译文") && menu.includes("复制中英对照"), "译文侧栏右键菜单项");

ok(menu && menu.includes("在文档中查找") && menu.includes("findSelection") && !menu.includes("显示更多选项"), "选区菜单扁平：查找所选直出、无「显示更多」");
ok(menu && menu.includes("text-overflow:ellipsis") && !menu.includes("lf-ctx-scroll"), "无滚动条 · 标签省略");
ok(menu && menu.includes("撤销上一批注"), "右键撤销批注项");

console.log("\n[2] Reader 集成");
ok(reader && reader.includes("onReaderContextMenu"), "contextmenu 处理器");
ok(reader && reader.includes("translationBlank") && reader.includes("tpCopyPage"), "译文空白区菜单动作");
ok(reader && reader.includes("ReaderContextMenu"), "挂载菜单");
ok(reader && reader.includes("Undo2") && reader.includes("undoAnno"), "顶栏撤销 + undoAnno");
ok(reader && reader.includes("redoAnno") && reader.includes("Redo2"), "顶栏重做");
ok(reader && reader.includes("canUndoAnno"), "撤销状态传入右键菜单");
ok(reader && reader.includes("setReaderContextHost"), "阅读器接管全局菜单");
ok(reader && !reader.includes("批注 · P3"), "已移除内部代号 P3");
ok(reader && reader.includes("条批注"), "用户可读批注状态");

console.log("\n[3] 共享与主进程");
ok(read("src/ui/reader-selection.js")?.includes("captureTextSelection"), "选区捕获共用");
ok(read("src/ui/reader-selection.js")?.includes("captureDomTextSelection"), "译文 DOM 选区捕获");
ok(read("src/ui/reader-context-host.js")?.includes("isReaderContextHost"), "host 标记");
ok(read("src/ui/reader-context-host.js")?.includes("rd-tp-head") && !read("src/ui/reader-context-host.js")?.includes(".rd-tp,"), "译文正文可接管右键、顶栏排除");
ok(app && app.includes("isReaderContextHost"), "LuminaApp 抑制重复菜单");
ok(ctx && ctx.includes('case "print"'), "打印动作");

console.log(`\nreader_context_menu：${pass}/${pass + fail}` + (fail ? " 失败" : " 全绿"));
process.exit(fail ? 1 : 0);
