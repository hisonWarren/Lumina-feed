#!/usr/bin/env node
// verify-lumina-subs-digest-sync.mjs — 订阅引擎对齐 + 简报 UX 2.0 结构验证
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const F = (p) => join(ROOT, p);
let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✓ " + m); pass++; };
const ng = (m) => { console.log("  ✗ " + m); fail++; };
const read = (p) => readFileSync(F(p), "utf8");
const has = (p, re, n) => (re.test(read(p)) ? ok(n) : ng(n + " 缺于 " + p));

console.log("\n[1] 核心 digest-search / digest-ai");
for (const p of ["src/core/subs/digest-search.ts", "src/core/subs/digest-ai.ts"]) existsSync(F(p)) ? ok(p) : ng("缺 " + p);
has("src/core/subs/digest-ai.ts", /generateDigestBlurb/, "generateDigestBlurb 模块");
has("src/core/subs/digest-ai.ts", /DIGEST_AI_CAP/, "AI 上限常量");
has("src/core/subs/digest-ai.ts", /readCachedSummary/, "缓存总结读取");
has("src/core/subs/digest-search.ts", /DIGEST_EXCLUDE_SOURCES/, "排除 libgen/annas/scihub");
has("src/core/subs/digest-search.ts", /JOURNAL_DIGEST_SOURCES/, "期刊 8 源白名单");
has("src/core/subs/digest-search.ts", /mergeDigestDisabled/, "mergeDigestDisabled");
has("src/core/subs/digest-search.ts", /readIds/, "readIds 用户已读");
has("src/core/subs/digest-search.ts", /countSubsUnread/, "countSubsUnread 待读徽标");
has("electron/ipc.ts", /subs:markRead/, "subs:markRead IPC");
has("electron/ipc.ts", /subs:markAllRead/, "subs:markAllRead IPC");
has("src/ui/lib/subs-unread.js", /countSubsUnread/, "渲染层 subs-unread");
has("src/core/subs/digest-search.ts", /dedupeDigestPapers/, "跨订阅 DOI 去重");

console.log("\n[2] IPC 引擎对齐");
has("electron/ipc.ts", /buildDigestSearchOpts/, "buildDigestSearchOpts");
has("electron/ipc.ts", /applyDigestSearchOpts/, "applyDigestSearchOpts 调用");
has("electron/ipc.ts", /subs:preview/, "subs:preview IPC");
has("electron/ipc.ts", /buildDigestSpec/, "buildDigestSpec 用于 run");
has("electron/ipc.ts", /digestNotifyTier/, "通知档位");
has("electron/ipc.ts", /mode === "blurb"/, "blurb 成本闸模式");
has("electron/ipc.ts", /runDigestAiPhase/, "runDigestAiPhase");
has("electron/ipc.ts", /subs:progress/, "subs:progress 事件");
has("electron/ipc.ts", /summaries:get/, "summaries:get IPC");
has("electron/ipc.ts", /asyncAi/, "异步 AI 队列");
has("src/core/subs/digest-search.ts", /filterDigestRecency/, "发表时间窗过滤");
has("src/core/subs/digest-search.ts", /todayDateKey/, "todayDateKey 日界");
has("electron/ipc.ts", /digestDateKey/, "run 时写入 todayDateKey");
has("electron/ipc.ts", /aiSkippedReason|skippedReason/, "AI 跳过原因");

console.log("\n[3] UI 简报 2.0");
for (const p of ["src/ui/components/DigestMatchWhy.jsx", "src/ui/components/DigestSourceLine.jsx", "src/ui/styles/subs-digest.css", "src/ui/lib/digest-ui.js"]) {
  existsSync(F(p)) ? ok(p) : ng("缺 " + p);
}
has("src/ui/modules/Subscriptions.jsx", /dg-tldr/, "TL;DR 顶栏");
has("src/ui/modules/Subscriptions.jsx", /subsPreview/, "试跑预览");
has("src/ui/modules/Subscriptions.jsx", /DigestMatchWhy/, "MatchWhy 组件");
has("src/ui/modules/Subscriptions.jsx", /dg-loadmore/, "Load More");
has("src/ui/modules/Subscriptions.jsx", /dedupeDigestEntries/, "全部视图去重");
has("renderer/entry.jsx", /subs-digest\.css/, "样式入口");

console.log("\n[4] 桥接");
has("electron/preload.ts", /subsPreview/, "preload subsPreview");
has("src/ui/lumina-bridge.js", /subsPreview/, "bridge subsPreview");
has("src/ui/modules/Subscriptions.jsx", /getCachedSummary/, "卡片加载缓存总结");
has("src/ui/modules/Subscriptions.jsx", /runProgress/, "runNow 进度");
has("electron/preload.ts", /onSubsProgress/, "preload onSubsProgress");
has("electron/preload.ts", /getCachedSummary/, "preload getCachedSummary");
has("src/ui/lumina-bridge.js", /digestSummary/, "digestSummary 卡片字段");

console.log("\n[5] 今日简报总报告");
for (const p of ["src/core/subs/digest-report.ts", "src/ui/components/DigestAbstract.jsx", "src/ui/components/DigestReportHero.jsx"]) {
  existsSync(F(p)) ? ok(p) : ng("缺 " + p);
}
has("electron/ipc.ts", /digestReport:get/, "digestReport:get IPC");
has("electron/ipc.ts", /digestReport:generate/, "digestReport:generate IPC");
has("electron/ipc.ts", /scheduleDigestReport/, "scheduleDigestReport 调度");
has("electron/preload.ts", /digestReportGet/, "preload digestReportGet");
has("electron/settings.ts", /digestReportAuto/, "digestReportAuto 设置");
has("src/ui/modules/Subscriptions.jsx", /DigestAbstract/, "列表摘要展示");
has("src/ui/modules/Subscriptions.jsx", /DigestReportHero/, "报告 Hero");
has("src/ui/modules/Subscriptions.jsx", /dg-view-seg/, "扫描/报告视图切换");
has("src/ui/modules/Settings.jsx", /digestReportAuto/, "设置页总报告开关");

console.log(`\n=== verify: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
