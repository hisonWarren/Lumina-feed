// lumina-feed · Electron 入口（干净基线：检索 · 取文 · 接地总结）
import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { existsSync, statSync, readFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { openBetterSqlite } from "../src/core/store/db.ts";
import { initStore, type Store } from "../src/core/store/index.ts";
import { setPoliteIdentity } from "../src/core/sources/adapter.ts";
import { keytarStore } from "../src/core/secrets/keyvault.ts";
import { registerIpc, startSubsScheduler } from "./ipc.ts";
import { loadAppSettings, saveAppSettings } from "./settings.ts";
import { installDefaultLimiters } from "../src/core/sources/rate-limit.ts";
import { installContextMenuBridge, runContextAction } from "./context-menu.ts";
import { installTrayMenuController, type AppNavigatePayload } from "./tray-menu.ts";

function appVersion(): string {
  try {
    const p = path.join(__dirname, "..", "package.json");
    return String(JSON.parse(readFileSync(p, "utf-8")).version || "0.0.0");
  } catch { return "0.0.0"; }
}

// 开发版与安装版隔离 userData，避免 npm start / 烟测数据污染正式安装包
const userDataDir = app.isPackaged ? "Lumina Feed" : "Lumina Feed Dev";
app.setPath("userData", path.join(app.getPath("appData"), userDataDir));

let win: BrowserWindow | null = null;
let store: Store;
const secrets = keytarStore();

// ── 后台运行 / 托盘 / 开机启动（订阅·每日简报：关窗后调度器继续跑，类似常驻后台应用）──
let tray: Tray | null = null;
let minimizeToTray = false;
let isQuiting = false;
let disposeTrayMenu: (() => void) | null = null;

function pdfDirPath(): string {
  const d = path.join(app.getPath("userData"), "pdfs");
  try { mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  return d;
}
function pdfPathForPaper(id: string): string {
  return path.join(pdfDirPath(), encodeURIComponent(id) + ".pdf");
}

function showMainWindow(): void {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    void createWindow();
  }
}

function navigateRenderer(payload: AppNavigatePayload): void {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send("app:navigate", payload); } catch { /* ignore */ }
  }
}

function wireTrayMenu(): void {
  if (!tray || !store) return;
  disposeTrayMenu?.();
  disposeTrayMenu = installTrayMenuController({
    tray,
    getWin: () => win,
    store,
    secrets,
    navigate: navigateRenderer,
    sendOpenPdf: sendOpenPdf,
    onQuit: () => { isQuiting = true; app.quit(); },
    ensureWindow: () => { void createWindow(); },
    version: appVersion(),
    pdfPath: pdfPathForPaper,
  });
}

function assetPath(...parts: string[]): string {
  return path.join(__dirname, "..", ...parts);
}

/** Windows 托盘推荐 16px；损坏/缺失的 tray.png 回退 icon.png 并运行时缩放。 */
function loadTrayImage(): Electron.NativeImage {
  const candidates = [assetPath("assets", "tray.png"), assetPath("assets", "icon.png")];
  const target = process.platform === "win32" ? 16 : 22;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      if (p.endsWith("tray.png") && statSync(p).size < 500) continue; // 构建失败时常见 133B 黑块
    } catch { continue; }
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) continue;
    const { width, height } = img.getSize();
    if (width !== target || height !== target) {
      img = img.resize({ width: target, height: target, quality: "best" });
    }
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createEmpty();
}

/** 隐藏菜单栏保留快捷键；右键菜单由渲染层主题化组件展示（中文+图标）。 */
function installTextEditingSupport(w: BrowserWindow) {
  const mod = process.platform === "darwin" ? "Cmd" : "Ctrl";
  const editSubmenu: MenuItemConstructorOptions[] = [
    { label: "撤销", accelerator: `${mod}+Z`, role: "undo" },
    { label: "重做", accelerator: process.platform === "darwin" ? `${mod}+Shift+Z` : `${mod}+Y`, role: "redo" },
    { type: "separator" },
    { label: "剪切", accelerator: `${mod}+X`, role: "cut" },
    { label: "复制", accelerator: `${mod}+C`, role: "copy" },
    { label: "粘贴", accelerator: `${mod}+V`, role: "paste" },
    { type: "separator" },
    { label: "全选", accelerator: `${mod}+A`, role: "selectAll" },
  ];
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  template.push({ label: "编辑", submenu: editSubmenu });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  installContextMenuBridge(w);
}

function createTray(): boolean {
  if (tray) return true;
  try {
    const img = loadTrayImage();
    if (img.isEmpty()) return false;
    tray = new Tray(img);
    tray.setToolTip("Lumina Feed");
    tray.on("click", () => { showMainWindow(); });
    wireTrayMenu();
    return true;
  } catch { return false; }
}

function ensureTray(): boolean {
  return createTray();
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
    win.webContents.send("open-local-pdf", {
      name: p.split(/[\\/]/).pop() || "document.pdf",
      data: buf,
      localPath: path.resolve(p),
    });
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
  const winIcon = existsSync(assetPath("assets", "icon.png")) ? assetPath("assets", "icon.png") : undefined;
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#F4F4F1",
    autoHideMenuBar: true,
    icon: winIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  installTextEditingSupport(win);
  await win.loadURL(process.env.VITE_DEV_SERVER_URL ?? `file://${path.join(__dirname, "../dist/index.html")}`);
  let firstLoad = true;
  win.webContents.on("did-finish-load", () => { if (!firstLoad) return; firstLoad = false; const p = pendingPdf || pdfFromArgv(process.argv); pendingPdf = null; if (p) void sendOpenPdf(p); });
  win.on("close", (e) => {
    if (!minimizeToTray || isQuiting) return;
    if (!ensureTray()) {
      if (win) dialog.showMessageBoxSync(win, {
        type: "warning",
        title: "Lumina Feed",
        message: "无法最小化到系统托盘",
        detail: "托盘图标不可用，窗口将正常关闭。请重新安装应用，或在「设置 → 通用」关闭后台运行。",
        buttons: ["知道了"],
      });
      minimizeToTray = false;
      void saveAppSettings(store, { app: { minimizeToTray: false } });
      return;
    }
    e.preventDefault();
    win && win.hide();
  });
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  installDefaultLimiters();
  store = initStore(await openBetterSqlite(path.join(app.getPath("userData"), "lumina.db")));
  try {
    const settings = await loadAppSettings(store);
    setPoliteIdentity({ tool: "lumina-feed", email: settings.contactEmail ?? process.env.LUMINA_CONTACT_EMAIL });
  } catch {
    setPoliteIdentity({ tool: "lumina-feed", email: process.env.LUMINA_CONTACT_EMAIL });
  }
  registerIpc({ store, secrets });
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url);
  });
  // 后台/启动设置：须在 createWindow 前读取，关窗 handler 才能立即生效
  try {
    const appCfg = ((await loadAppSettings(store)) as { app?: { minimizeToTray?: boolean; openAtLogin?: boolean } }).app || {};
    minimizeToTray = !!appCfg.minimizeToTray;
    if (minimizeToTray && !ensureTray()) {
      minimizeToTray = false;
      await saveAppSettings(store, { app: { ...appCfg, minimizeToTray: false } });
    }
    try { app.setLoginItemSettings({ openAtLogin: !!appCfg.openAtLogin }); } catch { /* 平台不支持则忽略 */ }
  } catch { /* 读设置失败用默认 */ }
  ipcMain.handle("app:setBackground", (_e, opts: { minimizeToTray?: boolean; openAtLogin?: boolean }) => {
    if (opts && typeof opts.minimizeToTray === "boolean") {
      if (opts.minimizeToTray) {
        if (!ensureTray()) {
          minimizeToTray = false;
          return { ok: false, error: "tray_unavailable", message: "系统托盘不可用，无法开启后台运行", trayReady: false };
        }
        minimizeToTray = true;
      } else {
        minimizeToTray = false;
      }
    }
    if (opts && typeof opts.openAtLogin === "boolean") { try { app.setLoginItemSettings({ openAtLogin: opts.openAtLogin }); } catch { /* 忽略 */ } }
    return { ok: true, trayReady: !!tray };
  });
  ipcMain.handle("app:getUserDataPath", () => app.getPath("userData"));
  ipcMain.handle("lumina:context-action", (_e, action: string, extra?: string) => {
    runContextAction(win?.webContents, action, extra);
  });
  await createWindow();
  createTray();
  startSubsScheduler(store, secrets); // 订阅调度：到期自动检索 + 通知（后台开启时关窗仍继续）
});

app.on("before-quit", () => { isQuiting = true; disposeTrayMenu?.(); });

app.on("window-all-closed", () => {
  if (minimizeToTray) return; // 后台运行：不退出，调度器与托盘保活
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  else win?.show();
});
