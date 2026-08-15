#!/usr/bin/env node
// 结构验证：订阅待读计数与报告入模统一（hideNoAbstract）+ 删除确认 + 更强简报
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return ""; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const core = read("src/core/subs/digest-search.ts");
const report = read("src/core/subs/digest-report.ts");
const ui = read("src/ui/lib/subs-unread.js");
const subs = read("src/ui/modules/Subscriptions.jsx");
const hero = read("src/ui/components/DigestReportHero.jsx");
const ai = read("src/core/subs/digest-ai.ts");
const ipc = read("electron/ipc.ts");

console.log("\n[1] 计数口径统一");
ok(/unreadTodayPapers/.test(core) && /digestPaperVisible/.test(core), "core: unreadTodayPapers + digestPaperVisible");
ok(/hideNoAbstract/.test(core) && /unreadTodayPapers\(sub\)/.test(report), "报告入模走 unreadTodayPapers");
ok(/unreadTodayPapers/.test(ui) && /digestPaperVisible/.test(ui), "UI lib 对齐");
ok(/unreadTodayPapers\(s\)/.test(subs) && /countSubsUnread\(subs\)/.test(subs), "Subscriptions 用统一计数");
ok(!/visiblePapers\s*=/.test(subs), "Subscriptions 不再自维护可见过滤分叉");

console.log("\n[2] 删除确认 · 历史保留");
ok(/pendingRemoveId/.test(subs) && /确认删除/.test(subs), "删除确认对话框");
ok(/历史回顾/.test(subs), "文案声明保留历史");
ok(/askRemoveSub/.test(subs) && !/onClick=\{\(\)\s*=>\s*subRemove\(s\.id\)\}/.test(subs), "垃圾桶先确认");

console.log("\n[3] 报告质量与 scope");
ok(/禁止/.test(report) && /主题词/.test(report), "SYS 禁止主题词堆砌");
ok(/180-420|150-420/.test(report), "更长 brief 字数要求");
ok(/slice\(0,\s*720\)/.test(report), "brief 上限放宽到 720");
ok(/highlights\.slice\(0,\s*4\)/.test(hero) && /dg-rp-points strip/.test(hero), "扫描区展示要点");
ok(/40–90|40-90/.test(ai) && /maxTokens:\s*160/.test(ai), "单篇 blurb 加长");
ok(/scope !== "all"/.test(ipc) && /runOne\(scope\)/.test(ipc), "单订阅跑完先刷该 scope 再刷 all");
ok(/unreadTodayCount\(subs\.find/.test(subs), "生成报告按当前 scope 判空");

console.log("\n[4] 运行时：hideNoAbstract 过滤");
const mod = await import(pathToFileURL(join(root, "src/ui/lib/subs-unread.js")).href);
const sub = {
  id: "t1",
  enabled: true,
  hideNoAbstract: true,
  readIds: [],
  today: [
    { id: "a", title: "with abs", abstract: "x".repeat(50) },
    { id: "b", title: "no abs", abstract: "" },
    { id: "c", title: "doi only", abstract: "short", doi: "10.1/x" },
  ],
};
ok(mod.unreadTodayCount(sub) === 2, "隐藏无摘要后待读=2（有摘要+DOI）");
ok(mod.unreadTodayPapers(sub).map((p) => p.id).join(",") === "a,c", "可见待读 id=a,c");
const subOff = { ...sub, hideNoAbstract: false };
ok(mod.unreadTodayCount(subOff) === 3, "关闭过滤后待读=3");

console.log("\n──────────────────────────────");
console.log(`subs count-unify：${pass}/${pass + fail}` + (fail ? " 失败" : " 全绿"));
process.exit(fail ? 1 : 0);
