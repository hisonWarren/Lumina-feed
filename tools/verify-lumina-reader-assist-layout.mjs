#!/usr/bin/env node
// 结构验证：阅读器「助手」面板布局契约 —— 单滚动 + sticky 底栏 + 统一满列宽
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const rd = read("src/ui/modules/Reader.jsx");
console.log("\n[1] 助手面板 · 单滚动 + sticky 输入区");
ok(/rd-zonepane\.assist[\s\S]{0,120}overflow-y:auto[\s\S]{0,60}scrollbar-gutter:stable/.test(rd), "assist 单容器滚动 + stable gutter");
ok(/\.rd-assist-foot\{[^}]*position:sticky[^}]*bottom:0/.test(rd), "输入区 sticky 贴底");
ok(!/rd-assist-scroll/.test(rd), "已移除双区 flex 撑满（rd-assist-scroll）");
ok(/className="rd-assist-main"/.test(rd), "主内容区 rd-assist-main");
ok(/className="rd-assist-compose"/.test(rd), "提问区 rd-assist-compose 卡片");

console.log("\n[2] 统一列宽");
ok(/\.rd-ai-act\{[^}]*width:100%/.test(rd), "通读按钮满列宽");
ok(/\.rd-asec\{[^}]*width:100%/.test(rd), "AssistSection 满列宽");
ok(/\.rd-scaffold\{[^}]*width:100%/.test(rd), "占位框满列宽");
ok(/\.rd-assist-main\{[^}]*padding:12px 12px/.test(rd), "主区左右对称 padding");

console.log("\n[3] 空态 UX · 提示贴近输入");
ok(/qa\.length === 0 &&[\s\S]*rd-assist-hint/.test(rd), "空问答提示在底栏（非滚动区死白）");
ok(/qa\.length > 0 &&[\s\S]*问答记录/.test(rd), "有问答时才显示问答记录区块");

console.log("\n──────────────────────────────");
console.log(`  reader_assist_layout：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
