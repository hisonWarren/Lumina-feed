#!/usr/bin/env node
// lumina-feed · Electron 构建：esbuild 打包 main/preload/renderer
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(ROOT, "assets");

const MAIN_EXTERNAL = [
  "electron",
  "better-sqlite3",
  "keytar",
  "nodemailer",
  "auto-launch",
  "pdfjs-dist",
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** 从 lumina-feed/icon.png 同步安装图标与托盘图标 */
async function syncIcons() {
  ensureDir(ASSETS);
  const brandIcon = path.join(ROOT, "icon.png");
  const iconPath = path.join(ASSETS, "icon.png");
  const trayPath = path.join(ASSETS, "tray.png");

  if (!fs.existsSync(brandIcon)) {
    console.warn("  ! 未找到 icon.png，跳过图标同步");
    return;
  }

  fs.copyFileSync(brandIcon, iconPath);

  try {
    await sharp(brandIcon).resize(32, 32, { fit: "cover" }).png().toFile(trayPath);
    const traySize = fs.statSync(trayPath).size;
    if (traySize < 500) throw new Error(`tray output too small (${traySize} bytes)`);
    const meta = await sharp(trayPath).metadata();
    if (meta.width !== 32 || meta.height !== 32) {
      throw new Error(`tray output wrong size (${meta.width}x${meta.height})`);
    }
    console.log("  ✓ icon.png → assets/icon.png + tray.png(32)");
  } catch (err) {
    console.warn("  ! 托盘图标缩放失败，使用原图:", err.message);
    fs.copyFileSync(brandIcon, trayPath);
  }
}

async function build() {
  console.log("\n  Lumina Feed · Electron 构建\n  " + "─".repeat(40));
  ensureDir(BUILD);
  ensureDir(DIST);
  await syncIcons();

  await esbuild.build({
    entryPoints: [path.join(ROOT, "electron/main.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: path.join(BUILD, "main.cjs"),
    external: MAIN_EXTERNAL,
    sourcemap: true,
    logLevel: "info",
  });

  await esbuild.build({
    entryPoints: [path.join(ROOT, "electron/preload.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: path.join(BUILD, "preload.cjs"),
    external: ["electron"],
    sourcemap: true,
    logLevel: "info",
  });

  await esbuild.build({
    entryPoints: [path.join(ROOT, "renderer/entry.jsx")],
    bundle: true,
    outfile: path.join(DIST, "renderer.js"),
    format: "esm",
    jsx: "automatic",
    loader: { ".jsx": "jsx", ".css": "css" },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  });

  fs.copyFileSync(path.join(ROOT, "renderer/index.html"), path.join(DIST, "index.html"));
  const cssOut = path.join(DIST, "renderer.css");
  if (fs.existsSync(cssOut)) {
    let html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
    if (!html.includes("renderer.css")) {
      html = html.replace("</head>", '  <link rel="stylesheet" href="./renderer.css" />\n</head>');
      fs.writeFileSync(path.join(DIST, "index.html"), html);
    }
  }

  // PDF.js worker → dist（同源加载，满足 CSP worker-src 'self'）。需先 npm install pdfjs-dist。
  const pdfWorker = path.join(ROOT, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  if (fs.existsSync(pdfWorker)) {
    fs.copyFileSync(pdfWorker, path.join(DIST, "pdf.worker.min.mjs"));
    console.log("  ✓ dist/pdf.worker.min.mjs");
  } else {
    console.warn("  ! 未找到 pdfjs-dist worker —— 请先 `npm install`（pdfjs-dist）");
  }

  console.log("\n  ✓ build/main.cjs");
  console.log("  ✓ build/preload.cjs");
  console.log("  ✓ dist/index.html + renderer.js\n");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
