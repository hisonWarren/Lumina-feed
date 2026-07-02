#!/usr/bin/env node
// lumina-feed · 发布 GitHub Release（上传当前 release/ 目录内各平台安装包）
// 用法：npm run release:gh    （需先 gh auth login 一次）
// CI 发版请 push tag：git tag v<version> && git push origin v<version>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const ver = pkg.version;
const tag = `v${ver}`;
const releaseDir = path.join(ROOT, "release");

const GH_DIR = "C:\\Program Files\\GitHub CLI";
const env = { ...process.env, Path: `${process.env.Path || process.env.PATH || ""};${GH_DIR}` };
const gh = (args, opts = {}) => execFileSync("gh", args, { stdio: "pipe", encoding: "utf-8", env, cwd: ROOT, ...opts });

function resolveRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf-8", cwd: ROOT }).trim();
    const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
    if (m) return m[1];
  } catch { /* ignore */ }
  return "hisonWarren/Lumina-feed";
}

const ASSET_PATTERNS = [
  (n) => n === `Lumina Feed Setup ${ver}.exe`,
  (n) => n === `Lumina Feed Setup ${ver}.exe.blockmap`,
  (n) => n === `Lumina Feed-${ver}.dmg`,
  (n) => n === `Lumina Feed-${ver}.dmg.blockmap`,
  (n) => n === `Lumina Feed-${ver}.AppImage`,
  (n) => n === "latest.yml",
  (n) => n === "latest-mac.yml",
  (n) => n === "latest-linux.yml",
];

function findAssets() {
  if (!fs.existsSync(releaseDir)) throw new Error(`未找到 release 目录：${releaseDir}（先 npm run dist）`);
  const names = fs.readdirSync(releaseDir);
  const assets = names
    .filter((n) => ASSET_PATTERNS.some((fn) => fn(n)))
    .map((n) => path.join(releaseDir, n));
  if (!assets.length) {
    throw new Error(
      `release/ 中未找到 v${ver} 的安装包。请先 npm run dist，或确认版本号与 package.json 一致。`
    );
  }
  return assets;
}

function main() {
  try { gh(["auth", "status"]); }
  catch {
    console.error("\n  ✗ 未登录 GitHub。请先在终端执行：\n\n    gh auth login\n\n  完成后重跑本命令。\n");
    process.exit(1);
  }

  const assets = findAssets();
  const repo = resolveRepoSlug();
  console.log(`\n  发布 ${tag} → ${repo}\n  ${"─".repeat(40)}`);
  assets.forEach((a) => console.log("  · " + path.basename(a)));

  const notesFile = path.join(ROOT, ".release-notes.tmp.md");
  const notes = [
    `Lumina Feed ${ver}`,
    "",
    "自动发布。安装包见下方 Assets。",
    "",
    "| 平台 | 文件 |",
    "|---|---|",
    "| Windows | `Lumina Feed Setup *.exe` |",
    "| macOS | `Lumina Feed-*.dmg` |",
    "| Linux | `Lumina Feed-*.AppImage` |",
  ].join("\n");
  fs.writeFileSync(notesFile, notes, "utf-8");

  let exists = false;
  try { gh(["release", "view", tag, "-R", repo]); exists = true; } catch { exists = false; }

  try {
    if (exists) {
      console.log(`  已存在 ${tag}，上传/覆盖资产…`);
      gh(["release", "upload", tag, ...assets, "--clobber", "-R", repo], { stdio: "inherit" });
    } else {
      console.log(`  创建新 release ${tag}…`);
      gh(
        ["release", "create", tag, ...assets, "--title", `Lumina Feed ${ver}`, "--notes-file", notesFile, "-R", repo],
        { stdio: "inherit" }
      );
    }
  } finally {
    try { fs.unlinkSync(notesFile); } catch { /* ignore */ }
  }

  console.log(`\n  ✓ 完成：https://github.com/${repo}/releases/tag/${tag}\n`);
}

main();
