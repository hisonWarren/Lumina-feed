#!/usr/bin/env node
// lumina-feed · 一键发布 GitHub Release（上传安装包）
// 用法：npm run release:gh    （需先 gh auth login 一次）
// 逻辑：读 package.json 版本 → 找 release/Lumina Feed Setup <ver>.exe(.blockmap) → gh release create/upload
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const ver = pkg.version;
const tag = `v${ver}`;
const releaseDir = path.join(ROOT, "release");

// 兼容 winget 安装但 PATH 未刷新的情况
const GH_DIR = "C:\\Program Files\\GitHub CLI";
const env = { ...process.env, Path: `${process.env.Path || process.env.PATH || ""};${GH_DIR}` };
const gh = (args, opts = {}) => execFileSync("gh", args, { stdio: "pipe", encoding: "utf-8", env, cwd: ROOT, ...opts });

function findAssets() {
  if (!fs.existsSync(releaseDir)) throw new Error(`未找到 release 目录：${releaseDir}（先 npm run dist）`);
  const names = fs.readdirSync(releaseDir);
  const exe = names.find((n) => n === `Lumina Feed Setup ${ver}.exe`);
  if (!exe) throw new Error(`未找到安装包 Lumina Feed Setup ${ver}.exe（先 npm run dist 打好当前版本）`);
  const assets = [path.join(releaseDir, exe)];
  const bm = `${exe}.blockmap`;
  if (names.includes(bm)) assets.push(path.join(releaseDir, bm));
  if (names.includes("latest.yml")) assets.push(path.join(releaseDir, "latest.yml"));
  return assets;
}

function main() {
  // 1) 校验已登录
  try { gh(["auth", "status"]); }
  catch { console.error("\n  ✗ 未登录 GitHub。请先在终端执行：\n\n    gh auth login\n\n  选择 GitHub.com → HTTPS → Login with a web browser，完成后重跑本命令。\n"); process.exit(1); }

  const assets = findAssets();
  console.log(`\n  发布 ${tag}\n  ${"─".repeat(40)}`);
  assets.forEach((a) => console.log("  · " + path.basename(a)));

  const notesFile = path.join(ROOT, ".release-notes.tmp.md");
  const notes = `Lumina Feed ${ver}\n\n自动发布，安装包见下方 Assets（Windows x64）。`;
  fs.writeFileSync(notesFile, notes, "utf-8");

  // 2) 已存在同名 release → 追加/覆盖资产；否则新建
  let exists = false;
  try { gh(["release", "view", tag]); exists = true; } catch { exists = false; }

  try {
    if (exists) {
      console.log(`  已存在 ${tag}，上传/覆盖资产…`);
      gh(["release", "upload", tag, ...assets, "--clobber"], { stdio: "inherit" });
    } else {
      console.log(`  创建新 release ${tag}…`);
      gh(["release", "create", tag, ...assets, "--title", `Lumina Feed ${ver}`, "--notes-file", notesFile], { stdio: "inherit" });
    }
  } finally {
    try { fs.unlinkSync(notesFile); } catch { /* ignore */ }
  }

  console.log(`\n  ✓ 完成：https://github.com/hisonWarren/lumina/releases/tag/${tag}\n`);
}

main();
