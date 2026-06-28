// lumina-feed · Electron 入口（干净基线：检索 · 取文 · 接地总结）
import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, clipboard, dialog, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { openBetterSqlite } from "../src/core/store/db.ts";
import { initStore, type Store } from "../src/core/store/index.ts";
import { setPoliteIdentity } from "../src/core/sources/adapter.ts";
import { keytarStore } from "../src/core/secrets/keyvault.ts";
import { registerIpc, startSubsScheduler } from "./ipc.ts";
import { loadAppSettings, saveAppSettings } from "./settings.ts";
import { installDefaultLimiters } from "../src/core/sources/rate-limit.ts";

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

/** 隐藏菜单栏但保留剪切/复制/粘贴快捷键；右键可编辑区弹出标准编辑菜单。 */
function installTextEditingSupport(w: BrowserWindow) {
  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
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
  template.push({ label: "Edit", submenu: editSubmenu });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  w.webContents.on("context-menu", (_e, params) => {
    const tpl: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      tpl.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      tpl.push({ role: "copy", enabled: params.editFlags.canCopy });
    } else if (params.linkURL) {
      tpl.push(
        { label: "打开链接", click: () => { if (/^https?:\/\//.test(params.linkURL)) void shell.openExternal(params.linkURL); } },
        { label: "复制链接", click: () => { clipboard.writeText(params.linkURL); } },
      );
    }
    if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: w });
  });
}

function createTray(): boolean {
  if (tray) return true;
  try {
    const img = loadTrayImage();
    if (img.isEmpty()) return false;
    tray = new Tray(img);
    tray.setToolTip("Lumina Feed");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "显示 Lumina", click: () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else void createWindow(); } },
      { type: "separator" },
      { label: "退出 Lumina", click: () => { isQuiting = true; app.quit(); } },
    ]));
    tray.on("click", () => { if (win) { win.isVisible() && !win.isMinimized() ? win.focus() : (win.show(), win.focus()); } });
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
  await createWindow();
  createTray();
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
