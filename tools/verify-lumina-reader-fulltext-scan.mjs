// 契约：证据/推断车道长文档走 map-reduce，助手总结分片上限提升
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
console.log("── reader_fulltext_scan（全文分段扫描）契约自检 ──");
try { execSync("node --experimental-strip-types --check src/core/reader/reader-plus.ts", { stdio: "pipe" }); ok(true, "reader-plus.ts strip-types"); }
catch { ok(false, "reader-plus.ts strip-types"); }
const rp = R("src/core/reader/reader-plus.ts");
const ra = R("src/core/reader/reader-ai.ts");
ok(/runStructuredMapReduce/.test(rp), "runStructuredMapReduce 存在");
ok(/pages\.length >= 4/.test(rp), "≥4 页触发分段扫描");
ok(/coverageBanner/.test(rp), "coverageBanner 覆盖提示");
ok(/dedupeClaims/.test(rp), "分段结果去重");
ok(/mergeFlowmapParts/.test(rp), "flowmap 分段合并");
ok(/export function chunkByPages/.test(ra), "chunkByPages 已导出");
ok(/MAX_CHUNKS = 16/.test(ra), "助手 map 分片上限 16");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
