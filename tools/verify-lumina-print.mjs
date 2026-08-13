#!/usr/bin/env node
// 结构验证：阅读器打印走隐藏窗原始 PDF，不再打印主窗口 chrome
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parsePrintPageRanges, pageRangesForScope } from "../src/ui/print-page-ranges.js";

const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, x) => typeof s === "string" && s.includes(x);

const main = read("electron/main.ts");
const ipc = read("electron/ipc.ts");
const print = read("electron/print-pdf.ts");
const pre = read("electron/preload.ts");
const ctx = read("electron/context-menu.ts");
const reader = read("src/ui/modules/Reader.jsx");
const bridge = read("src/ui/lumina-bridge.js");
const exp = read("src/ui/pdf-export.js");

console.log("\n[1] 主进程 · 隐藏窗打印");
ok(!!print && has(print, "registerPrintPdf") && has(print, "reader:printPdf"), "print-pdf 模块 + IPC");
ok(print && has(print, "dryRun") && has(print, "pathToFileURL"), "dryRun + file:// 载入原始 PDF");
ok(print && has(print, "refused_main_window") && has(print, "printWindowIsMain"), "拒绝打印主窗口");
ok(print && has(print, "new BrowserWindow") && has(print, "skipTaskbar: true"), "独立隐藏窗");
ok(ipc && has(ipc, "registerPrintPdf"), "ipc.ts 注册");
ok(pre && has(pre, "printPdf") && has(pre, "reader:printPdf"), "preload 暴露");

console.log("\n[2] 不再打印主窗口 chrome");
ok(ctx && /case\s+"print":/.test(ctx), "context-menu 仍有 print 分支");
ok(ctx && !/case\s+"print":[\s\S]{0,180}wc\.print\(/.test(ctx), "print 分支不再 wc.print");
ok(reader && !/contextAction\(\s*["']print["']\s*\)/.test(reader), "Reader 不再 contextAction(print)");
ok(reader && has(reader, "setPrintOpen(true)") && has(reader, "bridge.printPdf"), "Reader 走打印对话框 + bridge");

console.log("\n[3] 阅读器 UI");
ok(reader && has(reader, "rd-print-dlg") && has(reader, "当前页") && has(reader, "页码范围"), "打印对话框：全部/当前/范围");
ok(reader && has(reader, "含批注高亮") && has(exp, "buildAnnotatedPdfBytes"), "可选带批注");
ok(reader && has(reader, "Printer") && has(reader, "打印 (Ctrl/⌘ P)"), "工具栏打印按钮");
ok(bridge && has(bridge, "async printPdf") && has(bridge, "ipcCloneBytes"), "bridge.printPdf");

console.log("\n[4] 页码范围解析");
const r1 = parsePrintPageRanges("1-3,5,8-10", 12);
ok(Array.isArray(r1) && r1.length === 3 && r1[0].from === 1 && r1[0].to === 3 && r1[1].from === 5 && r1[2].from === 8 && r1[2].to === 10, "1-3,5,8-10");
const r2 = parsePrintPageRanges("2至4，7", 10);
ok(Array.isArray(r2) && r2.length === 2 && r2[0].from === 2 && r2[0].to === 4 && r2[1].from === 7, "中文至/逗号");
const r3 = pageRangesForScope("current", 4, "", 9);
ok(Array.isArray(r3) && r3[0].from === 4 && r3[0].to === 4, "当前页");
const r4 = pageRangesForScope("all", 1, "", 9);
ok(Array.isArray(r4) && r4.length === 0, "全部页不传 pageRanges");
ok(parsePrintPageRanges("99-100", 5).error === "out_of_range", "越界");
ok(parsePrintPageRanges("abc", 5).error, "非法 token");

console.log("\n[5] strip-types");
try {
  execSync("node --experimental-strip-types --check electron/print-pdf.ts", { stdio: "pipe" });
  ok(true, "print-pdf.ts strip-types");
} catch {
  ok(false, "print-pdf.ts strip-types");
}

console.log("\n──────────────────────────────");
console.log(`print 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：Ctrl+P 出对话框 · 打印预览是 PDF 页而非 Lumina 工具栏 · 当前页/范围 · 含批注");
process.exit(fail ? 1 : 0);
