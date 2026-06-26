// lumina-feed · Electron 应用入口（装配全部里程碑）
// 这是把 M1–M6 接成一个产品的总装：
//   M1 store ─ M3 OA全文 ─ M4 总结 ─ 证据可信性 grounding ─ M5 调度/推送 ─ M6 导出
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from "electron";
import path from "node:path";

import { openBetterSqlite } from "../src/core/store/db.ts";
import { initStore, type Store } from "../src/core/store/index.ts";
import { setPoliteIdentity } from "../src/core/sources/adapter.ts";
import { runSubscriptionDigest } from "../src/core/digest.ts";

import { Scheduler } from "../src/core/schedule/scheduler.ts";
import { electronLoginItemBackend, autoLaunchBackend, setAutostart } from "../src/core/schedule/autostart.ts";
import { Notifier } from "../src/core/notify/notifier.ts";
import { nativeChannel } from "../src/core/notify/channels/native.ts";
import { emailChannel } from "../src/core/notify/channels/email.ts";
import { telegramChannel } from "../src/core/notify/channels/telegram.ts";
import { webhookChannel } from "../src/core/notify/channels/webhook.ts";
import { keytarStore } from "../src/core/notify/keyvault.ts";
import type { Channel } from "../src/core/notify/types.ts";

import { llmFromConfig } from "../src/core/summarize/llm-client.ts";
import { sqliteSummaryCache } from "../src/core/summarize/summaries.repo.ts";
import { enrichDigestItems } from "../src/core/summarize/digest-glue.ts";
import type { SummarizeOptions } from "../src/core/summarize/types.ts";

import { makeOaFullTextProvider } from "../src/core/oa/provider.ts";
import { registerOaPdfBridge } from "../src/core/oa/electron-bridge.ts";

import { registerIpc } from "./ipc.ts";
import { loadAppSettings } from "./settings.ts";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let scheduler: Scheduler | null = null;
let store: Store;
const secrets = keytarStore();

async function buildChannels(): Promise<Channel[]> {
  const s = await loadAppSettings(store);
  const chans: Channel[] = [nativeChannel({ onClick: (d) => focusToDigest(d.subscriptionId) })];
  if (s.channels.email?.enabled) chans.push(emailChannel(s.channels.email, { getPassword: () => secrets.get("smtp_pass") as Promise<string> }));
  if (s.channels.telegram?.enabled) chans.push(telegramChannel({ ...s.channels.telegram, botToken: (await secrets.get("telegram_token")) ?? "" }));
  if (s.channels.webhook?.enabled) chans.push(webhookChannel({ ...s.channels.webhook, secret: (await secrets.get("webhook_secret")) ?? undefined }));
  return chans;
}

function focusToDigest(subId: string) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  win.webContents.send("open-digest", subId);
}

async function buildScheduler(): Promise<Scheduler> {
  const settings = await loadAppSettings(store);
  const notifier = new Notifier(await buildChannels(), { productName: "Lumina Feed", appDeepLink: "lumina://digest" });
  const llm = settings.llm ? await llmFromConfig(settings.llm, () => secrets.get(`${settings.llm!.provider}_key`)).catch(() => null) : null;
  const cache = sqliteSummaryCache(store.db);
  const fullText = makeOaFullTextProvider({
    email: settings.contactEmail,
    electronFetch: undefined, // 由 preload 桥在渲染侧注入；主进程内总结时可直接用 net 版（略）
  });

  return new Scheduler({
    loadSubscriptions: () => store.subs.list(),
    saveSubscription: (s) => store.subs.save(s),
    runDigest: async (sub, since) => {
      const r = await runSubscriptionDigest(sub, since, { store });          // M1：多源检索入库
      if (llm) {
        const opts = (sub.summarize as SummarizeOptions) ?? { source: "abstract_only", fetchPdf: "if_oa", depth: "tldr", language: "zh", scope: "digest_hits" };
        await enrichDigestItems(r.items, (id) => store.papers.getById(id), opts, { llm, fullText, cache }); // M4(+M3)：总结
      }
      return r;
    },
    notify: (digest) => { store.digests.save(digest); return notifier.dispatch(digest); }, // M5：推送
    onResult: (res) => win?.webContents.send("digest-result", res),
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 880, minWidth: 940, minHeight: 600,
    show: !process.argv.includes("--lumina-autostart"),
    frame: false,                       // issue5：无原生边框（自定义标题栏）
    titleBarStyle: "hidden",            // macOS：隐藏标题栏，保留红绿灯
    autoHideMenuBar: true,              // 不显示 File/Edit/View/Window/Help 菜单条
    backgroundColor: "#F1EFE8",         // 默认亮色，避免加载白闪/黑闪
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();                     // 彻底移除窗口菜单（Windows/Linux）
  await win.loadURL(process.env.VITE_DEV_SERVER_URL ?? `file://${path.join(__dirname, "../dist/index.html")}`);
  const emitMax = () => win?.webContents.send("win:maximized", win?.isMaximized() ?? false);
  win.on("maximize", emitMax);
  win.on("unmaximize", emitMax);
  win.on("close", async (e) => {
    const s = await loadAppSettings(store);
    if (s.backgroundEnabled && !(app as any).isQuiting) { e.preventDefault(); win?.hide(); } // B：托盘常驻
  });
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "../assets/tray.png"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Lumina Feed · 文献雷达");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Lumina Feed", click: () => { win?.show(); win?.focus(); } },
    { label: "立即检查新文献", click: () => void scheduler?.tick() },
    { type: "separator" },
    { label: "开机自启", type: "checkbox", checked: false, click: (mi) => void toggleAutostart(mi.checked) },
    { label: "退出", click: () => { (app as any).isQuiting = true; app.quit(); } },
  ]));
}

async function toggleAutostart(enabled: boolean) {
  const backend = process.platform === "linux"
    ? autoLaunchBackend({ appName: "Lumina Feed", appPath: process.execPath, isHidden: true })
    : electronLoginItemBackend({ openAsHidden: true });
  await setAutostart(enabled, backend);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);               // issue5：移除应用级菜单（File/Edit/View/Window/Help）
  setPoliteIdentity({ tool: "lumina-feed", email: process.env.LUMINA_CONTACT_EMAIL });
  store = initStore(await openBetterSqlite(path.join(app.getPath("userData"), "lumina.db")));
  await createWindow();
  buildTray();
  await registerOaPdfBridge();                 // M3：主进程 PDF 桥
  // 自定义标题栏窗口控制
  ipcMain.handle("win:minimize", () => win?.minimize());
  ipcMain.handle("win:maximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.handle("win:close", () => win?.close());
  ipcMain.handle("win:isMaximized", () => win?.isMaximized() ?? false);
  // 用默认浏览器打开外链（doi / 原文 / 机构访问）
  ipcMain.handle("shell:openExternal", (_e, url: string) => { if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url); });
  scheduler = await buildScheduler();
  registerIpc({ store, scheduler, secrets, rebuildScheduler: async () => { scheduler = await buildScheduler(); scheduler.start(); }, focusWindow: () => win?.show() });
  scheduler.start(60_000);                      // M5：tick + 启动即 catch-up
});

app.on("window-all-closed", async () => {
  const s = store ? await loadAppSettings(store) : { backgroundEnabled: false };
  if (!s.backgroundEnabled && process.platform !== "darwin") app.quit();
});
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); else win?.show(); });
app.on("before-quit", () => scheduler?.stop());
