#!/usr/bin/env node
// 结构验证：doubao_ep_cleanup —— ISSUE-015（豆包模型框区分 Model ID / 推理接入点 ep-）+ 死代码/陈旧注释清理。
// 仅结构级：UI 文案观感、ep- 真实连通须真机。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);

const st = read("src/ui/modules/Settings.jsx");
const rd = read("src/ui/modules/Reader.jsx");

console.log("\n[1] ISSUE-015 · 豆包模型框区分 Model ID / 推理接入点 ep-");
ok(has(st, 'provider === "doubao"') && /provider === "doubao" &&[\s\S]{0,400}set-hint/.test(st), "豆包供应商下显示模型框专属说明");
ok(has(st, "Model ID") && has(st, "推理接入点 ID"), "说明同时点明 Model ID 与 推理接入点 ID");
ok(has(st, 'model.trim().startsWith("ep-")'), "动态识别 ep- 前缀");
ok(has(st, "set-ep-ok") && /\.set-ep-ok\{/.test(st), "ep- 识别提示有专属样式");
ok(has(st, "账户未开通") && has(st, "404"), "提示账户未开通 Model ID 会 404（呼应 07 §1.4）");

console.log("\n[2] 死代码 / 陈旧注释清理");
ok(!/\n\.set\{/.test(st) && !has(st, ".set-inner{") && !has(st, ".set-card{"), "移除旧整页布局死 CSS（.set/.set-inner/.set-card）");
ok(!has(st, ".set-sec-h{") && !has(st, ".set-combo-cur{") && !has(st, ".set-combo-custom{"), "移除其余死 CSS（.set-sec-h/.set-combo-cur/.set-combo-custom）");
ok(has(st, "showCustomInput") && has(st, "customMode"), "保留 customMode/showCustomInput（provider_translate 契约 token，非死代码）");
ok(!/\.rd-zoom\{/.test(rd), "移除阅读器旧 .rd-zoom 死 CSS（已被 rd-zoom-wrap/btn 取代）");
ok(!has(st, "patch: settings") && has(st, "弹窗 + 左侧分类"), "Settings 头注释更新为弹窗+分类（去陈旧）");
ok(!has(rd, "留 P2/P3") && has(rd, "累积："), "Reader 头注释更新（P2/P3 已交付，去陈旧）");

console.log("\n[3] 防回归 · 保留既有验证器关键 token");
ok(has(st, 'visionConsent && !["openai", "anthropic", "ollama"].includes(provider)'), "保留 ISSUE-001 视觉警告原断言串");
ok(has(st, "视觉 / 多模态模型") && has(st, "可能不支持读图"), "保留豆包视觉提示 + 警告文案");
ok(has(st, '"set-combo-in set-mono"') && has(st, "set-combo-tg") && has(st, "set-key-eye") && has(st, "THEMES.map") && has(st, "PROVIDERS"), "保留 settings/search-settings 断言 token");
ok(has(st, "set-backdrop") && has(st, "set-rail") && has(st, 'activeCat === "llm"'), "保留弹窗+分类结构（reader_settings_shell 不回退）");
ok(has(rd, "rd-zoom-wrap") && has(rd, "const [night, setNight]") && has(rd, "panRef"), "保留阅读器缩放预设/夜读/抓手");

console.log("\n──────────────────────────────");
console.log(`  doubao_ep_cleanup：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
