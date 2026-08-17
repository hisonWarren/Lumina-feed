#!/usr/bin/env node
/** LetPub IF 解析结构 + 本地 HTML 样例校验 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { console.log("  ✓", n); pass++; } else { console.log("  ✗", n, e || ""); fail++; } };

const src = fs.readFileSync(path.join(ROOT, "src/core/journal/letpub-impact.ts"), "utf8");
ok("letpub-impact module", src.includes("parseLetPubImpactHtml") && src.includes("fetchLetPubImpactByIssn"));
ok("IF值 chart parse", /IF值/.test(src));
ok("五年IF parse", /五年IF/.test(src));

const ipc = fs.readFileSync(path.join(ROOT, "electron/journal-ipc.ts"), "utf8");
ok("liveJifSlot imports LetPub", ipc.includes("fetchLetPubImpactByIssn"));
ok("LetPub before WOS comment/order", /LetPub 优先[\s\S]*wos-journal\.info 回退/.test(ipc));

const ui = fs.readFileSync(path.join(ROOT, "src/ui/modules/Journals.jsx"), "utf8");
ok("UI shows jif.source", /jif\.source/.test(ui));
ok("copy mentions LetPub first", /优先 LetPub/.test(ui));

const sample = path.join(ROOT, "tools/_tmp-letpub-nature.html");
if (fs.existsSync(sample)) {
  // Dynamic import of built? Use regex parse mirror for offline check
  const html = fs.readFileSync(sample, "utf8");
  const m = html.match(/name\s*:\s*['"]IF值['"][\s\S]*?data\s*:\s*\[([0-9.,\s]+)\]/i);
  const nums = m ? m[1].split(",").map((s) => Number(s.trim())).filter(Number.isFinite) : [];
  ok("sample Nature IF chart last ≈56.1", nums.length && Math.abs(nums[nums.length - 1] - 56.1) < 0.05, nums.slice(-3));
  const five = html.match(/五年IF[\s\S]{0,400}?<\/td>\s*<TD[^>]*>([\s\S]*?)<\/td>/i);
  const fiveN = five && [...five[1].matchAll(/(\d+\.\d+)/g)].map((x) => Number(x[1])).pop();
  ok("sample Nature 五年IF ≈56.7", fiveN && Math.abs(fiveN - 56.702) < 0.05, fiveN);
} else {
  console.log("  · skip sample HTML (no tools/_tmp-letpub-nature.html)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
