#!/usr/bin/env node
// 结构验证：layout_align —— 两处观感对齐。
//  (1) 检索页：ff-head / ff-track 收敛宽 920→958，使搜索框·工具行·命中来源条的“白框左右边”
//      与结果卡片列（卡片 border-box = 920 内容 + 18×2 内边距 + 1×2 边框 = 958）对齐；卡片本身不动。
//  (2) 阅读首页空态：rh-inner 增加 justify-content:center（横向居中 左栏+主区 这一组，消除右侧空当）
//      + margin-block:auto（纵向居中，溢出时回落顶对齐可滚动，消除底部大片空白/“像坏了”）；保留 max-width:1280。
// 仅结构级：实际像素对齐、留白观感、窄屏堆叠、四主题辨识度须真机确认。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);

const lf  = read("src/ui/LuminaApp.jsx");
const ff  = read("src/ui/modules/FindFetch.jsx");
const hub = read("src/ui/modules/ReadHub.jsx");
const sp  = read("tools/verify-lumina-shell-polish.mjs");

console.log("\n[1] 检索页 · 头部与卡片列对齐（content-box 推导：卡片 border-box=958）");
ok(/\.ff-head\{[^}]*max-width:958px;margin:0 auto/.test(lf), "ff-head 收敛宽 → 958（搜索框/工具行左右边对齐卡片列）");
ok(/\.ff-track\{[^}]*max-width:958px/.test(ff), "ff-track 收敛宽 → 958（命中来源条左边对齐卡片列）");
ok(/\.ff-track\{[^}]*align-items:stretch/.test(ff), "ff-track 子项拉伸满列宽");
ok(/\.ff-session-bar\{[^}]*box-sizing:border-box[^}]*width:100%/.test(ff), "ff-session-bar border-box 满列宽");
ok(/\.ff-primary-banner\{[^}]*box-sizing:border-box[^}]*width:100%/.test(ff), "ff-primary-banner border-box 满列宽");
ok(/\.ff-track \.lf-sources\{[^}]*box-sizing:border-box[^}]*width:100%/.test(ff), "命中来源条 border-box 满列宽");
ok(!/\.ff-head\{[^}]*max-width:920px/.test(lf) && !/\.ff-track\{[^}]*max-width:920px/.test(ff), "旧 920 收敛宽已不在 ff-head/ff-track");
ok(/\.ff-card\{[^}]*padding:16px 18px[^}]*max-width:920px/.test(lf), "ff-card 仍为 max-width:920 + padding:18 + border:1（锚，不改 → border-box 958）");
ok(/\.ff-card\{[^}]*margin:0 auto 12px/.test(lf), "ff-card 仍居中（margin:0 auto）");

console.log("\n[2] 阅读首页空态 · 居中单列上下布局");
ok(/\.rh-inner\{[^}]*flex-direction:column/.test(hub), "rh-inner 上下布局（column）");
ok(/\.rh-inner\{[^}]*margin-block:auto/.test(hub), "rh-inner 纵向居中（margin-block:auto，溢出可滚动）");
ok(/\.rh-inner\{[^}]*max-width:760px/.test(hub), "rh-inner 单列宽 max-width:760");
ok(/\.rh\{[^}]*overflow-y:auto/.test(hub) && /\.rh\{[^}]*align-items:center/.test(hub), "rh 可滚动 + 横向居中");

console.log("\n[3] 防回归 · 保留列表面板样式与主结构");
ok(/\.rh-rail\{[^}]*background:var\(--surf2\)[^}]*border:1px solid var\(--line\)/.test(hub), "列表区独立面板（底色+边框）保留");
ok(/\.rh-rail \.rh-sec \+ \.rh-sec\{border-top/.test(hub), "面板内分区分隔线保留");
ok(!has(hub, "order:-1") && !/\.rh-rail\{[^}]*position:sticky/.test(hub), "已移除左栏 sticky/order（回归上下）");
ok(has(hub, 'className="rh-main"') && has(hub, 'className="rh-rail"'), "rh-main + rh-rail 保留");
ok(/\.ff-card\{[^}]*transition:box-shadow/.test(lf), "ff-card hover 过渡保留（shell-polish 断言 token）");
ok(sp === null || /max-width:958px;margin:0 auto/.test(sp), "shell-polish 验证器已同步为 958（自身不回归）");

console.log("\n──────────────────────────────");
console.log(`  layout_align：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
