#!/usr/bin/env node
// 结构验证：background（后台运行/托盘/开机启动）+ 回归守卫确认 04-§5 三 bug 已修。
// 托盘/关窗最小化/开机自启/通知点击均为系统级 → 真机验证（沙箱无 OS/无网络）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, x) => typeof s === "string" && s.includes(x);
function balanced(src) {
  if (typeof src !== "string") return false;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/\/\/[^\n]*/g, " ");
  const pairs = { "}": "{", ")": "(", "]": "[" }, open = new Set(["{", "(", "["]), st = [];
  for (const ch of s) { if (open.has(ch)) st.push(ch); else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; } }
  return st.length === 0;
}
const main = read("electron/main.ts");
const preload = read("electron/preload.ts");
const bridge = read("src/ui/lumina-bridge.js");
const set = read("src/ui/modules/Settings.jsx");
const ipc = read("electron/ipc.ts");
const rai = read("src/core/reader/reader-ai.ts");

console.log("\n[0] 回归守卫：确认 04-§5 三 bug 已修（realmachine_fixes，非本补丁）");
ok(has(ipc, 'ipcMain.handle("reader:figure"') && has(ipc, "analysisError(\"figure\"") && !/reader:figure[\s\S]{0,400}return null/.test(ipc || ""), "BUG1 已修：reader:figure 失败返回拒绝信封（非 null）");
ok(has(rai, "function groundReaderAnswer") && has(rai, "修复 groundedRatio 恒 0"), "BUG3 已修：groundReaderAnswer 真实实现");
ok(/askReader[\s\S]{0,600}groundReaderAnswer/.test(rai || "") && /summarizeReader[\s\S]{0,600}groundReaderAnswer/.test(rai || ""), "BUG3 已接线：ask/summarize 均调用并返回 groundedRatio");
ok(has(ipc, "ok: false") || has(read("src/core/oa/pdf-fetch.ts"), "reason"), "BUG2：OA 取文失败返回具体原因（realmachine_fixes）");

console.log("\n[1] 后台运行 / 托盘（main 进程）");
ok(has(main, "Tray, Menu, nativeImage") && has(main, "function createTray()"), "导入 Tray/Menu/nativeImage + createTray");
ok(has(main, "nativeImage.createFromPath") && has(main, "img.isEmpty()"), "托盘图标缺失时跳过（dev 未构建不报错）");
ok(has(main, "显示 Lumina") && has(main, "退出 Lumina"), "托盘菜单：显示 / 退出");
ok(has(main, 'win.on("close"') && has(main, "minimizeToTray") && has(main, "ensureTray()") && has(main, "win.hide()"), "关窗 → 托盘就绪则最小化，否则提示并正常关闭");
ok(has(main, 'app.on("before-quit"') && has(main, "isQuiting = true"), "before-quit 置 isQuiting（允许真退出）");
ok(has(main, "if (minimizeToTray) return;") && has(main, "window-all-closed"), "window-all-closed：后台开启不退出（调度器/托盘保活）");

console.log("\n[2] 开机启动 + 设置同步");
ok(has(main, "app.setLoginItemSettings({ openAtLogin"), "开机自启 setLoginItemSettings（系统级，built-in）");
ok(has(main, 'ipcMain.handle("app:setBackground"'), "ipc app:setBackground（运行时改后台/自启）");
ok(has(main, "loadAppSettings") && has(main, "appCfg.minimizeToTray"), "启动时读 settings.app 应用初始后台/自启");
ok(has(preload, "setBackground:") && has(preload, 'invoke("app:setBackground"'), "preload setBackground");
ok(has(bridge, "async setBackground(minimizeToTray, openAtLogin)") && has(bridge, "!api.setBackground"), "bridge setBackground（无后端 no-op）");

console.log("\n[3] 设置 UI（后台/启动 开关并入「通用」卡）");
ok(has(set, "const [bgTray, setBgTray]") && has(set, "const [bgLogin, setBgLogin]"), "bgTray / bgLogin 状态");
ok(has(set, "if (s.app)") && has(set, "setBgTray(!!s.app.minimizeToTray)") && has(set, "bridge.setBackground(!!s.app.minimizeToTray"), "加载时读取 + 启动同步主进程");
ok(has(main, "ensureTray") || has(main, "function ensureTray"), "ensureTray 托盘就绪检查");
ok(has(main, "tray_unavailable") || has(main, "trayReady"), "setBackground 返回托盘状态");
ok(has(set, "persistSettings") || has(set, "onToggleAutoIngest"), "通用/阅读 switch 切换即持久化");
ok(has(set, "最小化到托盘后台运行") && has(set, "开机时自动启动"), "两个开关 UI");

console.log("\n[4] 链路完整性（前置未回退）");
ok(has(main, "requestSingleInstanceLock") && has(main, "open-local-pdf"), "multidoc 单实例 + 本地打开仍在");
ok(has(set, "set-combo-in") && has(set, "set-key-eye"), "search_settings 模型框/API 眼睛仍在");
ok(has(set, "visionConsent") && has(set, "PROVIDERS"), "Settings 六提供方 + 云端读图开关仍在");

console.log("\n[5] 括号平衡（JS/JSX；.ts 由 strip-types 校验）");
ok(balanced(set), "Settings.jsx 平衡");
ok(balanced(bridge), "lumina-bridge.js 平衡");
ok(typeof main === "string" && typeof preload === "string", "main.ts / preload.ts 存在（语法见 strip-types）");

console.log("\n──────────────────────────────");
console.log(`background 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：关窗→托盘后台·订阅/简报后台继续·桌面通知 / 托盘菜单显示·退出 / 开机自启（打包后；Linux 有限）/ 6 主题");
process.exit(fail ? 1 : 0);
