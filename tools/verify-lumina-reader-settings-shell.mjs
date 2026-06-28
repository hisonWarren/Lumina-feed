#!/usr/bin/env node
// 结构验证：reader_settings_shell（收尾整合包）——
//  阅读器：续读位置 / 键盘快捷键 / 缩放预设 / 夜读反色 / 抓手平移；
//  设置：弹窗 + 左侧分类导航（大模型/阅读/外观/隐私/通用/关于），视觉读图迁入「隐私」；
//  壳层：设置以弹窗叠加于当前视图之上（底层视图不丢）；
//  阅读首页：左栏改为有背景/分隔的独立面板（区域区分）+ 加宽布局；
//  检索页：命中来源标签收进带标签的容器条。
// 整合 doubao（供应商+视觉）与 verify_hygiene（套件全绿）。仅结构级——视觉/布局/交互/真实 LLM 须真机。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);

const rd = read("src/ui/modules/Reader.jsx");
const st = read("src/ui/modules/Settings.jsx");
const app = read("src/ui/LuminaApp.jsx");
const hub = read("src/ui/modules/ReadHub.jsx");
const ff = read("src/ui/modules/FindFetch.jsx");

console.log("\n[1] 阅读器 · 续读位置 / 快捷键 / 缩放预设 / 夜读 / 抓手");
ok(has(rd, "const [rememberPos, setRememberPos]") && has(rd, "posLoadedRef"), "续读位置状态 + 单次恢复守卫");
ok(has(rd, "reader.positions") && /positions\[docKey\]|positions:\s*\{[\s\S]{0,80}docKey/.test(rd), "按 docKey 持久化阅读位置（合并写回设置）");
ok(/getSettings[\s\S]{0,260}positions\[docKey\]/.test(rd) || has(rd, "s.reader.positions[docKey]"), "打开时按 docKey 恢复上次页码");
ok(has(rd, 'e.key === "f" || e.key === "F"') && has(rd, "setFindOpen(true)"), "Ctrl/⌘+F 打开查找");
ok(has(rd, 'e.key === "Home"') && has(rd, 'e.key === "End"'), "Home / End 跳首末页");
ok(/mod && \(e\.key === "=" \|\| e\.key === "\+"\)/.test(rd) && /mod && e\.key === "-"/.test(rd) && /mod && e\.key === "0"/.test(rd), "Ctrl/⌘ +/-/0 缩放快捷键");
ok(has(rd, 't.tagName === "INPUT"') && has(rd, "isContentEditable"), "输入框内不抢快捷键");
ok(has(rd, "function fitPage") || has(rd, "const fitPage"), "缩放预设：适配整页");
ok(has(rd, "const actualSize") && has(rd, "setScale(1)"), "缩放预设：实际大小 100%");
ok(has(rd, "rd-zoom-menu") && has(rd, "实际大小") && has(rd, "适配整页"), "缩放预设菜单 UI");
ok(has(rd, "const [night, setNight]") && has(rd, ".rd.night .rd-pg canvas{filter:invert"), "夜读反色：状态 + 仅反相页面 canvas");
ok(has(rd, "const [hand, setHand]") && has(rd, "panRef") && has(rd, "scrollLeft = panRef.current"), "抓手平移：状态 + 拖动改滚动");
ok(has(rd, "(night ? \" night\" : \"\")") && has(rd, "(hand ? \" hand\" : \"\")"), "night / hand 类挂到 DOM");
ok(/import \{[^}]*\bMoon\b[^}]*\bHand\b/.test(rd), "Moon / Hand 图标已导入");

console.log("\n[2] 设置 · 弹窗 + 左侧分类导航");
ok(has(st, "set-backdrop") && has(st, "set-modal") && has(st, 'role="dialog"') && has(st, 'aria-modal="true"'), "弹窗外壳（backdrop + dialog）");
ok(has(st, "const CATS") && has(st, "set-rail") && has(st, 'role="tablist"'), "左侧分类导航 CATS + tablist");
ok(has(st, 'activeCat === "llm"') && has(st, 'activeCat === "reader"') && has(st, 'activeCat === "privacy"') && has(st, 'activeCat === "about"'), "分类面板：大模型/阅读/隐私/关于");
ok(has(st, "const [rememberPos, setRememberPos]") && has(st, "const [defaultZoom") && has(st, "const [nightInvert") && (has(st, "persistReaderPrefs") || has(st, "onToggleRememberPos")), "「阅读」分类：续读/默认缩放/夜读 + 即时持久化");
ok(has(st, 'aria-label="设置"') && has(st, "onClose") && has(st, "set-close"), "关闭按钮 + onClose");
ok(/addEventListener\("keydown", onKey, true\)/.test(st) && has(st, "stopImmediatePropagation"), "捕获阶段 Esc 关闭（不扰动底层阅读器）");
ok(has(st, 'activeCat === "privacy"') && /privacy[\s\S]{0,1200}visionConsent/.test(st) && !/activeCat === "llm"[\s\S]{0,1500}aria-checked=\{visionConsent\}/.test(st), "云端读图迁入「隐私」分类（已移出大模型）");
// 保留既有验证器断言的关键 token（防回归）
ok(has(st, 'visionConsent && !["openai", "anthropic", "ollama"].includes(provider)'), "保留 ISSUE-001 视觉警告原断言串");
ok(has(st, '"set-combo-in set-mono"') && has(st, "set-key-eye") && has(st, "THEMES.map") && has(st, "setSecret(") && has(st, "_key"), "保留 search-settings / settings 断言 token");

console.log("\n[3] 壳层 · 设置弹窗叠加（底层视图不丢）");
ok(has(app, "const [prevMode, setPrevMode]"), "prevMode 状态");
ok(has(app, 'const view = mode === "settings" ? prevMode : mode'), "底层视图＝settings 时取 prevMode");
ok(has(app, '{mode === "settings" && (') && /onClose=\{\(\) => setMode\(prevMode\)\}/.test(app), "Settings 作为叠加层渲染 + onClose 回前视图");
ok(/onClick=\{\(\) => \{ if \(mode !== "settings"\) setPrevMode\(mode\); setMode\("settings"\); \}\}/.test(app), "齿轮记忆当前视图再开设置");
ok(has(app, 'view === "find"') && has(app, 'view === "read"'), "主舞台按 view 渲染各模块");

console.log("\n[4] 阅读首页 · 上下布局 + 列表面板");
ok(/\.rh-inner\{[^}]*flex-direction:column/.test(hub), "rh-inner 上下布局（column）");
ok(/\.rh-rail\{[^}]*background:var\(--surf2\)[^}]*border:1px solid var\(--line\)/.test(hub), "列表区有背景+边框的独立面板");
ok(/\.rh-rail \.rh-sec \+ \.rh-sec\{border-top/.test(hub), "面板内分区有分隔线");
ok(/\.rh-inner\{[^}]*max-width:760px/.test(hub), "单列居中宽 max-width:760");

console.log("\n[5] 检索页 · 命中来源标签收进容器条");
ok(/\.ff-sources\{[^}]*background:var\(--surf2\)/.test(ff) || has(read("src/ui/components/HitSources.jsx"), "lf-sources-v2"), "来源标签条改为带背景/边框的容器（ff-sources 或 HitSources lf-sources-v2）");
ok((has(ff, "ff-src-label") && has(ff, "命中来源")) || (has(read("src/ui/components/HitSources.jsx"), 'className="lbl"') && has(read("src/ui/components/HitSources.jsx"), "来源")), "来源条加标签（不再裸贴左）");

console.log("\n[6] 整合 · doubao + 全绿");
ok(has(read("src/core/summarize/llm-client.ts"), "doubao") && has(st, 'id: "doubao"'), "豆包供应商已含（引擎 + 设置）");

console.log("\n──────────────────────────────");
console.log(`  reader_settings_shell：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
