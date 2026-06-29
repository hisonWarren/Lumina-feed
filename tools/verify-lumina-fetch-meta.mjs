#!/usr/bin/env node
// 结构级验证 · 多源取文 UI 语义层（fetch-meta + 阅读闭环）
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
let fail = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { console.log("  \x1b[31m✗ " + m + "\x1b[0m"); fail++; };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

console.log("\n— 1. fetch-meta 层 —");
exists("src/ui/fetch-meta.js") ? ok("fetch-meta.js") : bad("缺 fetch-meta.js");
exists("src/ui/FetchBadges.jsx") ? ok("FetchBadges.jsx") : bad("缺 FetchBadges.jsx");
if (exists("src/ui/fetch-meta.js")) {
  const m = read("src/ui/fetch-meta.js");
  /FETCH_STAGES/.test(m) && /开放获取/.test(m) && /备用库/.test(m) ? ok("阶段文案 + 用户语言") : bad("缺阶段/来源映射");
  /stageTextFromTrace/.test(m) && /fetchFailHint/.test(m) ? ok("trace 驱动阶段 + 失败提示") : bad("缺 trace 阶段映射");
  /sourceLabel/.test(m) && /buildFetchedMeta/.test(m) ? ok("sourceLabel + buildFetchedMeta") : bad("缺核心 API");
  /tier.*alt|ALT_SUMMARY_CAVEAT/.test(m) ? ok("alt tier + 总结 caveat") : bad("缺 alt caveat");
  try { execSync(`node --check "${path.join(ROOT, "src/ui/fetch-meta.js")}"`, { stdio: "pipe" }); ok("fetch-meta node --check"); } catch { bad("fetch-meta 语法"); }
}

console.log("\n— 2. LuminaApp 统一 state —");
if (exists("src/ui/LuminaApp.jsx")) {
  const a = read("src/ui/LuminaApp.jsx");
  /fetchedMeta/.test(a) && /fetchingMeta/.test(a) ? ok("fetchedMeta / fetchingMeta") : bad("缺统一取文 state");
  /onReadPaper/.test(a) && /readTarget/.test(a) ? ok("onReadPaper + readTarget") : bad("缺阅读闭环");
  /buildFetchedMeta/.test(a) ? ok("toast 含来源 label") : bad("未接 buildFetchedMeta");
  /\.ff-b-ft/.test(a) && /\.ff-b-alt/.test(a) && /\.ff-b-nooa/.test(a) ? ok("BASE_CSS 徽章变体") : bad("缺 badge CSS");
}

console.log("\n— 3. 模块接线 —");
const ff = exists("src/ui/modules/FindFetch.jsx") ? read("src/ui/modules/FindFetch.jsx") : "";
/ff-b-ft|FetchBadges|fetchProgressUi/.test(ff) && !/下一补丁/.test(ff) ? ok("FindFetch 徽章 + 阅读按钮") : bad("FindFetch 未更新");
const sd = exists("src/ui/modules/SummaryDrawer.jsx") ? read("src/ui/modules/SummaryDrawer.jsx") : "";
/fetchedMeta/.test(sd) && /onReadPaper/.test(sd) && /ALT_SUMMARY_CAVEAT/.test(sd) ? ok("SummaryDrawer 来源 + caveat + 阅读") : bad("SummaryDrawer 未更新");
const sub = exists("src/ui/modules/Subscriptions.jsx") ? read("src/ui/modules/Subscriptions.jsx") : "";
/allPending|取本批全部/.test(sub) && /fetchedMeta/.test(sub) ? ok("Subscriptions 全量 batch") : bad("Subscriptions 未更新");
const rh = exists("src/ui/modules/ReadHub.jsx") ? read("src/ui/modules/ReadHub.jsx") : "";
/readTarget/.test(rh) ? ok("ReaderModule readTarget") : bad("ReadHub 未接 readTarget");

console.log("\n" + (fail ? `\x1b[31m✗ 未通过：${fail} 错\x1b[0m\n` : `\x1b[32m✓ 结构级验证通过\x1b[0m\n`));
process.exit(fail ? 1 : 0);
