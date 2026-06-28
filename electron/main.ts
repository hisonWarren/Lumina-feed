// lumina-feed · Electron 入口（干净基线：检索 · 取文 · 接地总结）
import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } from "electron";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { openBetterSqlite } from "../src/core/store/db.ts";
import { initStore, type Store } from "../src/core/store/index.ts";
import { setPoliteIdentity } from "../src/core/sources/adapter.ts";
import { keytarStore } from "../src/core/secrets/keyvault.ts";
import { registerIpc, startSubsScheduler } from "./ipc.ts";
import { loadAppSettings } from "./settings.ts";

// 统一 userData 目录（与 npm 包名 lumina-feed 解耦，避免旧测试数据被安装版误读）
app.setPath("userData", path.join(app.getPath("appData"), "Lumina Feed"));

let win: BrowserWindow | null = null;
let store: Store;
const secrets = keytarStore();

// ── 后台运行 / 托盘 / 开机启动（订阅·每日简报：关窗后调度器继续跑，类似常驻后台应用）──
let tray: Tray | null = null;
let minimizeToTray = false;
let isQuiting = false;
function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, "../assets/tray.png"));
    if (img.isEmpty()) return; // 图标缺失（dev 未构建 assets）→ 跳过托盘，不报错
    tray = new Tray(img);
    tray.setToolTip("Lumina Feed");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "显示 Lumina", click: () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else void createWindow(); } },
      { type: "separator" },
      { label: "退出 Lumina", click: () => { isQuiting = true; app.quit(); } },
    ]));
    tray.on("click", () => { if (win) { win.isVisible() && !win.isMinimized() ? win.focus() : (win.show(), win.focus()); } });
  } catch { /* 托盘不可用则忽略 */ }
}

// ── 本地 PDF 打开（OS 右键关联 / 命令行 / 拖到 Dock）：单实例 + open-file(mac) + second-instance(win/linux) ──
const gotLock = app.requestSingleInstanceLock();
let pendingPdf: string | null = null;
function pdfFromArgv(argv: string[]): string | null {
  for (const a of (argv || []).slice(1)) { if (typeof a === "string" && !a.startsWith("-") && /\.pdf$/i.test(a)) return a; }
  return null;
}
async function sendOpenPdf(p: string | null) {
  if (!p || !win) return;
  try {
    const buf = await readFile(p);
    win.webContents.send("open-local-pdf", { name: p.split(/[\\/]/).pop() || "document.pdf", data: buf });
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  } catch { /* 文件不可读则忽略 */ }
}
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } void sendOpenPdf(pdfFromArgv(argv)); });
  app.on("open-file", (e, p) => { e.preventDefault(); if (win) void sendOpenPdf(p); else pendingPdf = p; }); // macOS
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#F4F4F1",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  await win.loadURL(process.env.VITE_DEV_SERVER_URL ?? `file://${path.join(__dirname, "../dist/index.html")}`);
  let firstLoad = true;
  win.webContents.on("did-finish-load", () => { if (!firstLoad) return; firstLoad = false; const p = pendingPdf || pdfFromArgv(process.argv); pendingPdf = null; if (p) void sendOpenPdf(p); });
  win.on("close", (e) => { if (minimizeToTray && !isQuiting) { e.preventDefault(); win && win.hide(); } }); // 后台开启时：关闭=最小化到托盘
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  setPoliteIdentity({ tool: "lumina-feed", email: process.env.LUMINA_CONTACT_EMAIL });
  store = initStore(await openBetterSqlite(path.join(app.getPath("userData"), "lumina.db")));
  await createWindow();
  // oa:fetchPdf 由 reader_engine 在 ipc.ts 注册（含落盘）；不再用 electron-bridge 重复注册
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url);
  });
  registerIpc({ store, secrets });
  // 后台/启动设置：启动时读取并应用（关窗行为 + 开机自启）
  try {
    const appCfg = ((await loadAppSettings(store)) as { app?: { minimizeToTray?: boolean; openAtLogin?: boolean } }).app || {};
    minimizeToTray = !!appCfg.minimizeToTray;
    try { app.setLoginItemSettings({ openAtLogin: !!appCfg.openAtLogin }); } catch { /* 平台不支持则忽略 */ }
  } catch { /* 读设置失败用默认 */ }
  createTray();
  ipcMain.handle("app:setBackground", (_e, opts: { minimizeToTray?: boolean; openAtLogin?: boolean }) => {
    if (opts && typeof opts.minimizeToTray === "boolean") minimizeToTray = opts.minimizeToTray;
    if (opts && typeof opts.openAtLogin === "boolean") { try { app.setLoginItemSettings({ openAtLogin: opts.openAtLogin }); } catch { /* 忽略 */ } }
    return { ok: true };
  });
  ipcMain.handle("app:getUserDataPath", () => app.getPath("userData"));
  startSubsScheduler(store, secrets); // 订阅调度：到期自动检索 + 通知（后台开启时关窗仍继续）
});

app.on("before-quit", () => { isQuiting = true; });

app.on("window-all-closed", () => {
  if (minimizeToTray) return; // 后台运行：不退出，调度器与托盘保活
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  else win?.show();
});
