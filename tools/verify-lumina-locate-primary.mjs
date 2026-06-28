#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

console.log("\n[1] Title Fast Lane 核心");
ok(read("src/core/locate/title-like.ts")?.includes("isTitleLikeQuery"), "title-like 检测");
ok(read("src/core/locate/title-fast-lane.ts")?.includes("titleFastLane"), "title-fast-lane");
ok(read("src/core/locate/primary-hit.ts")?.includes("pickPrimaryHit"), "primary-hit");
ok(read("src/core/locate/locate-stream.ts")?.includes("runLocateKeywordStream"), "locate-stream");

console.log("\n[2] IPC 接线");
const ipc = read("electron/ipc.ts");
ok(ipc?.includes("runLocateKeywordStream"), "流式定位");
ok(ipc?.includes("searchLocalByTitle"), "本地标题检索");
ok(ipc?.includes('locateMode: primary'), "primary 预取");

console.log("\n[3] 渲染层 UX");
const ff = read("src/ui/modules/FindFetch.jsx");
ok(ff?.includes("mergeStreamResults"), "流式合并置顶");
ok(ff?.includes("ff-primary-banner"), "primary 横幅");
ok(ff?.includes("primaryPaperId"), "primary 状态");
const stable = read("src/ui/lib/stable-order.js");
ok(stable?.includes("pinExactMatches") && stable?.includes("pinPrimaryId"), "精确匹配置顶");

console.log("\n[4] 预取扩展");
ok(read("src/core/locate/prefetch-eligibility.ts")?.includes('"primary"'), "primary 预取资格");

console.log(`\nlocate_primary：${pass}/${pass + fail}` + (fail ? " 失败" : " 全绿"));
process.exit(fail ? 1 : 0);
