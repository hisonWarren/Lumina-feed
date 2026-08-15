#!/usr/bin/env node
/** v0.4.107 结构验证：简报手动默认 + keep-ready + JIF 诚实空态 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const F = (p) => join(ROOT, p);
let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✓ " + m); pass++; };
const ng = (m) => { console.log("  ✗ " + m); fail++; };
const read = (p) => readFileSync(F(p), "utf8");
const has = (p, re, n) => (re.test(read(p)) ? ok(n) : ng(n + " · " + p));

console.log("\n── verify-lumina-digest-manual-jif ──\n");
has("electron/settings.ts", /digestReportAuto:\s*false/, "digestReportAuto 默认 false");
has("electron/settings.ts", /digestManualAiDefaultV04107/, "一次性迁移 flag");
has("src/core/subs/digest-report.ts", /keepBody|上一版 ready|保留上一版/, "生成中保留上一版正文");
has("src/core/subs/digest-report.ts", /正文完全缺失/, "core 软化质量 stale");
has("src/ui/lib/subs-unread.js", /正文完全缺失/, "UI 软化质量 stale");
{
  const s = read("src/ui/lib/subs-unread.js");
  if (/brief\.length < 80/.test(s)) ng("subs-unread 仍含 brief<80 硬 stale");
  else ok("subs-unread 已无 brief<80 硬 stale");
}
has("src/ui/modules/Subscriptions.jsx", /if \(!digestReportAuto\) return/, "UI 自动生成受 digestReportAuto 门控");
has("src/ui/modules/Subscriptions.jsx", /autoSummarize \|\| \"off\"/, "新建订阅 AI 默认 off");
has("src/ui/components/DigestReportHero.jsx", /正在更新报告/, "生成中保留正文横幅");
has("src/ui/components/DigestReportHero.jsx", /手动生成/, "空态不再声称必然自动生成");
has("src/ui/modules/Journals.jsx", /暂不可用|在线拉取未命中/, "JIF 诚实失败文案");
has("electron/journal-ipc.ts", /timeoutMs:\s*45000/, "JIF 竞速超时加长");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
