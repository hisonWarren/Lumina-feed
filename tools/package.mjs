#!/usr/bin/env node
// lumina-feed · 源码打包（zip，供分发/归档）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const name = pkg.name;
const version = pkg.version;
const outDir = path.join(ROOT, "dist");
const zipName = `${name}-${version}.zip`;
const zipPath = path.join(outDir, zipName);

console.log("\n  Lumina Feed · 打包");
console.log("  " + "─".repeat(40));

console.log("\n  → npm run verify\n");
const verify = spawnSync("npm", ["run", "verify"], { cwd: ROOT, stdio: "inherit", shell: true });
if (verify.status !== 0) {
  console.error("\n  ✗ 验证未通过，中止打包\n");
  process.exit(verify.status ?? 1);
}

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const exclude = new Set(["node_modules", "dist", ".git"]);
const toZip = fs.readdirSync(ROOT).filter((e) => !exclude.has(e));

if (process.platform === "win32") {
  const ps = [
    `$src = '${ROOT.replace(/'/g, "''")}'`,
    `$dst = '${zipPath.replace(/'/g, "''")}'`,
    `$items = @(${toZip.map((e) => `'${e.replace(/'/g, "''")}'`).join(", ")})`,
    `Compress-Archive -Path ($items | ForEach-Object { Join-Path $src $_ }) -DestinationPath $dst -Force`,
  ].join("; ");
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else {
  const r = spawnSync("zip", ["-r", zipPath, ...toZip], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const size = fs.statSync(zipPath).size;
console.log(`\n  ✓ ${zipPath}`);
console.log(`  ✓ ${(size / 1024).toFixed(1)} KB\n`);
