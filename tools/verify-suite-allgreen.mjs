#!/usr/bin/env node
// 套件全绿守门：运行 tools/ 下所有 verify-lumina-*.mjs，断言「零红」。
// 取代旧的「恰好 4 红」基线——全绿是更强的回归不变量：此后任意一项变红即真问题。
// 注：本文件名非 verify-lumina-*，故不会把自己纳入扫描（无递归）。
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const dir = join(root, "tools");
let files;
try {
  files = readdirSync(dir).filter((f) => /^verify-lumina-.*\.mjs$/.test(f)).sort();
} catch {
  console.error("✗ 找不到 tools/ 目录（请在仓库根运行）"); process.exit(2);
}

let green = 0; const red = [];
for (const f of files) {
  try {
    execFileSync(process.execPath, [join(dir, f)], { stdio: "ignore" });
    green++;
  } catch {
    red.push(f);
  }
}

console.log(`\n套件扫描：${files.length} 个 verify-lumina-*，GREEN=${green}，RED=${red.length}`);
if (red.length) {
  console.log("仍为红的：");
  for (const r of red) console.log("  ✗ " + r);
  console.log("\n✗ 套件未全绿。");
  process.exit(1);
}
console.log("✓ 套件全绿（all green）——零红不变量成立。");
process.exit(0);
