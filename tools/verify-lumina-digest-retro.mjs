#!/usr/bin/env node
// 结构级验证 · synra_patch_lumina_digest_retro（前置：subscriptions / subscriptions_journal）。
// 订阅回顾：历史归档（snapshots）+ 关于你的图表 + 分层 AI 回顾；并修「确保当日」与两个 verify 误报。
// 沙箱只验结构/契约/不变量；真机命中、LLM 回顾、IPC 往返、可视化须真机确认（见末尾提示）。
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
let fail = 0, warn = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { console.log("  \x1b[31m✗ " + m + "\x1b[0m"); fail++; };
const wn = (m) => { console.log("  \x1b[33m! " + m + "\x1b[0m"); warn++; };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const has = (p, re) => exists(p) && re.test(read(p));

// 朴素剥离（字符串/注释）——足够给 {}/[] 计数；() 对正则/JSX 不可靠故仅提示
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/\/\/[^\n]*/g, " ");
}
function balance(p) {
  const s = strip(read(p));
  let okAll = true;
  for (const [o, c] of [["{", "}"], ["[", "]"]]) {
    const a = s.split(o).length - 1, b = s.split(c).length - 1;
    if (a !== b) { bad(`${p}: ${o}${c} 不平衡 (${a}/${b})`); okAll = false; }
  }
  for (const [o, c] of [["(", ")"]]) {
    const a = s.split(o).length - 1, b = s.split(c).length - 1;
    if (a !== b) wn(`${p}: () 可能不平衡 (${a}/${b}) —— 裸计数对 JSX/正则不可靠，以 build:electron 为准`);
  }
  return okAll;
}

console.log("\n— 1. 前置（subscriptions 已应用）—");
has("src/ui/modules/Subscriptions.jsx", /dg-view-seg/) ? ok("subscriptions 在（简报视图段控件）") : bad("缺 subscriptions —— 请先应用");
has("src/core/subs/digest-report.ts", /digestReportStorageKey/) ? ok("digest-report 在") : bad("缺 digest-report.ts");

console.log("\n— 2. 新文件存在 + 括号平衡 —");
const NEW = [
  "src/core/subs/digest-archive.ts",
  "src/core/subs/digest-retro.ts",
  "src/ui/components/RetroChart.jsx",
  "src/ui/components/DigestRetro.jsx",
  "src/ui/styles/subs-retro.css",
];
for (const f of NEW) {
  if (!exists(f)) { bad("缺 " + f); continue; }
  ok("有 " + f);
  if (/\.(ts|jsx)$/.test(f) && balance(f)) ok(f + " 括号平衡");
}

console.log("\n— 3. 确保「当日」（核心修复）—");
has("src/core/subs/digest-report.ts", /dateKey\?: string/) ? ok("collectDigestReportInputs 收 dateKey") : bad("collectDigestReportInputs 未加 dateKey 参数");
has("src/core/subs/digest-report.ts", /String\(s\.todayDateKey \|\| ""\) === dateKey/) ? ok("当日过滤：todayDateKey === 报告日") : bad("缺当日过滤（昨天 today[] 会混入今天报告）");
has("src/core/subs/digest-report.ts", /collectDigestReportInputs\(subs, scope, dateKey\)/) ? ok("runDigestReportGeneration 透传 dateKey") : bad("runDigestReportGeneration 未透传 dateKey");

console.log("\n— 4. 历史归档引擎（snapshots；永不删 papers/工作集）—");
const ARC = "src/core/subs/digest-archive.ts";
has(ARC, /CREATE TABLE IF NOT EXISTS digest_snapshots/) ? ok("digest_snapshots 表") : bad("缺 digest_snapshots 表");
has(ARC, /export function recordDigestSnapshot/) ? ok("recordDigestSnapshot") : bad("缺 recordDigestSnapshot");
has(ARC, /export function listSnapshotDates/) ? ok("listSnapshotDates") : bad("缺 listSnapshotDates");
has(ARC, /export function loadSnapshot/) ? ok("loadSnapshot") : bad("缺 loadSnapshot");
has(ARC, /export function pruneDigestHistory/) ? ok("pruneDigestHistory") : bad("缺 pruneDigestHistory");
// 红线：清理绝不碰 papers / library / fulltext
if (exists(ARC)) {
  const a = read(ARC);
  /DELETE FROM papers|DELETE FROM library|DELETE FROM fulltext/.test(a)
    ? bad("pruneDigestHistory 触碰了 papers/library/fulltext（红线：工作集永不自动删）")
    : ok("清理只删 snapshots + digest_report 缓存，不碰 papers/工作集");
  /retentionDays <= 0|!retentionDays/.test(a) ? ok("retention<=0/省略 = 永久保留（默认慷慨）") : wn("未见「永久保留」短路，请确认默认不误删");
}
has("electron/ipc.ts", /recordDigestSnapshot\(store, dateKey, String\(norm\.id/) ? ok("persistSubscriptionToday 记录当天 deliveredFresh") : bad("ipc 未在 persist 时记录快照");

console.log("\n— 5. 回顾分析（确定性序列 + 分层 AI；接地口径）—");
const RET = "src/core/subs/digest-retro.ts";
has(RET, /export function buildRetroSeries/) ? ok("buildRetroSeries（确定性图表数据）") : bad("缺 buildRetroSeries");
has(RET, /export async function generateRetroAnalysis/) ? ok("generateRetroAnalysis（分层 AI 回顾）") : bad("缺 generateRetroAnalysis");
has(RET, /digestReportStorageKey\(dk, "all"\)/) ? ok("复用已存每日报告作窗口输入（绕开 8 篇上限）") : wn("未见复用每日报告，AI 回顾可能重复归纳");
has(RET, /paperRefs/) ? ok("AI 结论挂 paperRefs（可点跳）") : bad("回顾结论未挂 paper 锚点");

console.log("\n— 6. 接地诚实口径（关于你的 feed，非领域统计）—");
has(RET, /禁止.*该领域|不是该领域|非系统综述/) ? ok("AI 系统提示锁死：禁止「该领域转向」") : bad("AI 提示未禁止领域级措辞（红线4：接地诚实）");
has(RET, /RETRO_FRAMING/) ? ok("RETRO_FRAMING 诚实横幅常量") : bad("缺 RETRO_FRAMING");
has("src/ui/components/DigestRetro.jsx", /你的订阅|你的 feed|样本有偏/) ? ok("UI 横幅：关于你的订阅 · 样本有偏") : bad("UI 缺诚实横幅");
// 不得出现把样本当全域的「断言」；诚实划界的否定语境（不是领域趋势…）应放行
if (exists("src/ui/components/DigestRetro.jsx")) {
  const t = read("src/ui/components/DigestRetro.jsx");
  const FIELD = /(领域趋势|学界趋势|该领域的?发表|研究热点整体|该领域转向)/g;
  let assertive = false, m;
  while ((m = FIELD.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 8), m.index);
    if (!/(不是|并非|而非|非|无关|不做)/.test(before)) assertive = true;
  }
  assertive ? bad("UI 出现领域级断言（应只讲「你的 feed」）") : ok("UI 仅在否定语境提及领域（诚实划界），无领域级断言");
}

console.log("\n— 7. IPC / preload / bridge 契约（5 通道）—");
const CH = ["digestHistory:dates", "digestHistory:get", "digestRetro:series", "digestRetro:analyze", "digestHistory:purge"];
for (const c of CH) has("electron/ipc.ts", new RegExp(`ipcMain\\.handle\\("${c.replace(":", "\\:")}"`)) ? ok("ipc handler " + c) : bad("缺 ipc handler " + c);
const PM = ["digestHistoryDates", "digestHistoryGet", "digestRetroSeries", "digestRetroAnalyze", "digestHistoryPurge"];
for (const m of PM) has("electron/preload.ts", new RegExp(m + ":")) ? ok("preload " + m) : bad("缺 preload " + m);
for (const m of PM) has("src/ui/lumina-bridge.js", new RegExp("async " + m + "\\(")) ? ok("bridge " + m) : bad("缺 bridge " + m);
has("src/ui/lumina-bridge.js", /!api\.digestRetroSeries\) return null/) ? ok("bridge 无引擎 mock 兜底（UI 可裸渲染）") : wn("bridge 未见 mock 兜底");

console.log("\n— 8. 保留策略设置 —");
has("electron/settings.ts", /digestHistoryRetentionDays\?: number/) ? ok("AppSettings.digestHistoryRetentionDays") : bad("缺保留天数设置项");
has("electron/settings.ts", /digestHistoryRetentionDays: 365/) ? ok("DEFAULTS 默认 365 天（慷慨）") : bad("DEFAULTS 缺默认保留天数");
has("electron/ipc.ts", /pruneDigestHistory\(store, s0\.digestHistoryRetentionDays\)/) ? ok("启动按保留策略清理") : wn("未见启动清理调用");

console.log("\n— 9. UI 设计纪律 —");
// 选中态 = 实心 petrol + 白字（UX §2）
has("src/ui/styles/subs-retro.css", /\.rt-seg button\.on\s*\{[^}]*background:var\(--gold\)[^}]*color:#fff/) ? ok("段控件选中 = 实心 petrol + 白字") : bad("段控件选中态不符 UX §2");
has("src/ui/styles/subs-retro.css", /\.rt-dayitem\.on\s*\{[^}]*var\(--gold\)/) ? ok("历史项选中 = 实心 petrol") : wn("历史项选中态请确认 petrol");
// 组件内禁写死 hex（CSS 文件允许）
for (const f of ["src/ui/components/RetroChart.jsx", "src/ui/components/DigestRetro.jsx"]) {
  if (!exists(f)) continue;
  const inlineHex = (read(f).match(/#[0-9a-fA-F]{3,6}\b/g) || []);
  inlineHex.length === 0 ? ok(path.basename(f) + " 无写死 hex（走 token/color-mix）") : bad(path.basename(f) + " 出现写死 hex：" + inlineHex.slice(0, 3).join(","));
}
// 图表响应式：viewBox（禁固定像素宽）
has("src/ui/components/RetroChart.jsx", /viewBox=/) ? ok("图表用 viewBox（响应式）") : bad("图表缺 viewBox（应响应式）");
// 数字/标识用 mono
has("src/ui/styles/subs-retro.css", /var\(--mono\)/) ? ok("数字/日期用 --mono") : wn("未见 --mono");

console.log("\n— 10. Hook 渲染安全（无危险条件调用）—");
// 检测「cond && BigComp({...})」式调用（应为 <Comp/>）。允许纯小写工具函数。
for (const f of ["src/ui/components/DigestRetro.jsx", "src/ui/components/RetroChart.jsx"]) {
  if (!exists(f)) continue;
  const danger = (read(f).match(/&&\s*[A-Z][A-Za-z0-9]+\(\{/g) || []);
  danger.length === 0 ? ok(path.basename(f) + " 无危险条件式组件调用（均 <Comp/>）") : bad(path.basename(f) + " 危险条件调用 " + danger.length + " 处");
}

console.log("\n— 11. 误报修复（之前的问题）—");
has("tools/verify-lumina-engine-final.mjs", /ftsPrep\\\(raw\\\)/) ? ok("engine-final ftsPrep 正则已对齐两步重构") : wn("engine-final ftsPrep 修复未检出（确认已应用）");
has("tools/verify-lumina-subscriptions.mjs", /\(\) 可能不平衡/) ? ok("subscriptions () 误报已降级为提示") : wn("subscriptions () 修复未检出（确认已应用）");

console.log("");
if (fail === 0) console.log(`\x1b[32m✓ 结构级验证通过\x1b[0m（${warn} 警）`);
else console.log(`\x1b[31m✗ ${fail} 项失败\x1b[0m（${warn} 警）`);
console.log("真机须确认：① 订阅按计划真实检索后快照逐日累积 ② AI 回顾在配置 LLM 下产出且口径正确 ③ 图表/历史浏览的 IPC 往返与渲染 ④ 清理只删历史、papers/工作集无损。");
process.exit(fail === 0 ? 0 : 1);
