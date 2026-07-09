#!/usr/bin/env node
// 结构验证：packaging（electron-builder 配置 + .pdf 文件关联）。
// ⚠️ 仅验证「配置形态 + 产物路径 + B2 处理器在位」——【无法验证 electron-builder 能否真正打包/关联/签名】。
// 打包、安装、右键关联、双击、多平台、签名/公证：全部真机/构建，沙箱不可验（见 DESIGN_NOTES / EXIT_CRITERIA）。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

let pkg = null;
try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")); } catch { /* */ }
const b = (pkg && pkg.build) || {};
const hasTarget = (plat, name) => arr(b[plat] && b[plat].target).some((t) => (typeof t === "string" ? t : t && t.target) === name);
const arr = (x) => Array.isArray(x) ? x : [];
const main = (() => { try { return readFileSync(join(root, "electron/main.ts"), "utf-8"); } catch { return ""; } })();

console.log("\n[1] package.json 合法 + electron-builder 配置形态");
ok(!!pkg, "package.json 合法 JSON");
ok(!!b.appId && !!b.productName, "appId + productName");
ok(b.directories && b.directories.output === "release", "directories.output = release");
ok(arr(b.files).includes("build/**/*") && arr(b.files).includes("dist/**/*"), "files 含 build/ + dist/（main/preload + 渲染层产物）");
ok(arr(b.asarUnpack).some((s) => s.includes("better-sqlite3")) && arr(b.asarUnpack).some((s) => s.includes("keytar")), "asarUnpack 含原生模块 better-sqlite3 + keytar");

console.log("\n[2] .pdf 文件关联（opt-in，不强占默认）");
const fa = arr(b.fileAssociations).find((f) => f && f.ext === "pdf");
ok(!!fa, "fileAssociations 含 .pdf");
ok(fa && fa.role === "Viewer", "role = Viewer（查看器，非编辑器）");
ok(fa && fa.rank === "Alternate", "rank = Alternate（不强占默认 PDF 处理器）");

console.log("\n[3] 多平台目标 + 图标");
ok(hasTarget("win", "nsis") && b.win.icon, "win: nsis + 图标");
ok(hasTarget("mac", "dmg") && b.mac.icon, "mac: dmg + 图标");
ok(hasTarget("linux", "AppImage") && arr(b.linux.mimeTypes).includes("application/pdf"), "linux: AppImage + mimeTypes(application/pdf)");

console.log("\n[4] 脚本 + 依赖");
ok(pkg && pkg.scripts && /electron-builder/.test(pkg.scripts.dist || ""), "scripts.dist 调 electron-builder");
ok(pkg && pkg.scripts && /build:electron/.test(pkg.scripts.dist || ""), "dist 先跑 build:electron（产出 build/ + dist/）");
ok(pkg && pkg.devDependencies && pkg.devDependencies["electron-builder"], "devDependencies 含 electron-builder");

console.log("\n[5] 引用产物存在（构建过即在；否则先 npm run build:electron）");
ok(existsSync(join(root, "build/main.cjs")), "build/main.cjs");
ok(existsSync(join(root, "build/preload.cjs")), "build/preload.cjs");
ok(existsSync(join(root, "dist/index.html")) && existsSync(join(root, "dist/renderer.js")), "dist/index.html + renderer.js");
ok(existsSync(join(root, "assets/icon.png")), "assets/icon.png（electron-builder 据此生成各平台图标）");

console.log("\n[6] 关联要「有用」需 B2 主进程处理在位（multidoc_open）");
ok(main.includes("open-local-pdf") && main.includes("requestSingleInstanceLock"), "main.ts 含 open-local-pdf + 单实例（否则关联打开无反应）");

console.log("\n──────────────────────────────");
console.log(`packaging 配置验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("⚠️ 仅验证配置形态/产物/处理器。【真机/构建必验，沙箱不可验】：");
console.log("   npm i -D electron-builder → npm run dist（逐 OS）→ 安装 → 右键「用 Lumina 打开」/ 双击 / 拖到 Dock / 已开窗口再打开(单实例)");
console.log("   原生模块重建（electron-builder install-app-deps）/ 代码签名(mac 公证·win 证书，否则 Gatekeeper/SmartScreen 拦截) / 1024² icon.png → .ico/.icns");
process.exit(fail ? 1 : 0);
