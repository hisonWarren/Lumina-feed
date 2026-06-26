#!/usr/bin/env node
// lumina-feed · 总验证：依次运行全部里程碑行为门，聚合结果。
// 运行：node tools/verify-all.mjs
import { spawnSync } from "node:child_process";

const GATES = [
  ["M1 数据底座", "verify-data-core.mjs"],
  ["M3 合法 OA 全文", "verify-oa-fulltext.mjs"],
  ["M4 总结管线", "verify-summarize.mjs"],
  ["M5 调度 + 推送", "verify-scheduler-push.mjs"],
  ["M6 导出", "verify-export.mjs"],
  ["证据可信性", "verify-trust.mjs"],
];

let totalPass = 0, totalFail = 0;
const rows = [];

for (const [name, file] of GATES) {
  const r = spawnSync("node", ["--experimental-strip-types", "--experimental-sqlite", `tools/${file}`], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  let pass = 0, fail = 0;
  if (m) { pass = +m[1]; fail = +m[2]; }
  else { // 末行被 process.exit 截断时，回退数 ✓ / FAIL
    pass = (out.match(/✓/g) ?? []).length;
    fail = (out.match(/✗ FAIL/g) ?? []).length;
    if (!pass && !fail) fail = 1; // 完全没跑起来
  }
  totalPass += pass; totalFail += fail;
  rows.push([name, pass, fail, fail === 0 ? "PASS" : "FAIL"]);
}

console.log("\n  Lumina Feed · 全里程碑验证\n  " + "─".repeat(46));
for (const [name, p, f, status] of rows) {
  console.log(`  ${status === "PASS" ? "✓" : "✗"} ${name.padEnd(18)}  ${String(p).padStart(3)} passed  ${f ? String(f) + " failed" : ""}  [${status}]`);
}
console.log("  " + "─".repeat(46));
console.log(`  合计：${totalPass} passed, ${totalFail} failed  →  ${totalFail === 0 ? "全部通过 ✅" : "有失败 ❌"}\n`);
process.exitCode = totalFail ? 1 : 0;
