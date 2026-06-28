#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (m) => { console.log("  \x1b[32m✓\x1b[0m " + m); pass++; };
const bad = (m) => { console.log("  \x1b[31m✗ " + m + "\x1b[0m"); fail++; };

console.log("\n[1] 核心 · reading-history");
ok(read("src/core/reader/reading-history.ts").includes("reading_history"));
ok(read("src/core/reader/reading-history.ts").includes("recordReadingOpen"));
ok(read("src/core/store/db.ts").includes("reading_history"));

console.log("\n[2] IPC / preload");
const ipc = read("electron/ipc.ts");
ok(ipc.includes('"reader:continueList"'));
ok(ipc.includes('"reader:recordOpen"'));
ok(ipc.includes('"reader:readLocalPdf"'));
ok(ipc.includes("openedAtForPaper"));
const pre = read("electron/preload.ts");
ok(pre.includes("continueList"));
ok(pre.includes("readLocalPdf"));

console.log("\n[3] bridge / ReadHub UX");
const br = read("src/ui/lumina-bridge.js");
ok(br.includes("continueList") && br.includes("openContinueEntry"));
const hub = read("src/ui/modules/ReadHub.jsx");
ok(hub.includes("继续阅读"));
ok(!hub.includes("会话内有效"));
ok(hub.includes("continueList"));
ok(hub.includes("全部已下载全文"));
ok(hub.includes("localPath"));

console.log("\n[4] Reader 续读同步");
const rd = read("src/ui/modules/Reader.jsx");
ok(rd.includes("recordReadingPage"));
ok(rd.includes("startPage"));
ok(rd.includes('local:" + source.localPath'));

console.log("\n[5] 设置清除");
ok(read("src/ui/modules/Settings.jsx").includes("clearContinueReading"));

console.log(`\ncontinue_reading：${pass}/${pass + fail}` + (fail ? " 失败" : " 全绿"));
process.exit(fail ? 1 : 0);
