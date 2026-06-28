#!/usr/bin/env node
// lumina-feed · 快速启动：结构级 verify + 可选构建
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("\n  Lumina Feed · 干净基线\n  " + "─".repeat(40));
console.log(`  Node ${process.version}  ·  ${ROOT}\n`);

const verify = spawnSync("node", ["tools/verify-lumina-summary-drawer.mjs"], { cwd: ROOT, stdio: "inherit" });
if (verify.status !== 0) process.exit(verify.status ?? 1);

const build = spawnSync("node", ["tools/build-electron.mjs"], { cwd: ROOT, stdio: "inherit" });
process.exit(build.status ?? 0);
