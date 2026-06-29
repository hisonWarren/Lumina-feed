// lumina-feed · 系统托盘菜单（状态区 + 简报/阅读捷径 + 设置/退出）
import { BrowserWindow, dialog, Menu, Tray, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../src/core/store/index.ts";
import { normalizeSubscription, countSubsUnread } from "../src/core/subs/digest-search.ts";
import {
  ensureReadingHistoryTable,
  isSafeLocalPdfPath,
  listContinueReading,
  type ReadingHistoryRow,
} from "../src/core/reader/reading-history.ts";
import { getTrayMetrics, runAllSubscriptionsNow, setTrayRefreshHook } from "./ipc.ts";
import type { SecretStore } from "../src/core/secrets/keyvault.ts";

export type AppNavigatePayload = {
  view: "find" | "subs" | "library" | "read" | "settings";
  settingsCat?: string;
  continueEntry?: Record<string, unknown>;
};

export interface TraySnapshot {
  unreadCount: number;
  subCount: number;
  enabledSubCount: number;
  lastRunAgo: string | null;
  fetchPending: number;
  fetchActive: number;
  searchInflight: number;
  subsBatchRunning: boolean;
  continueEntry: Record<string, unknown> | null;
  windowVisible: boolean;
}

export interface TrayControllerOptions {
  tray: Tray;
  getWin: () => BrowserWindow | null;
  store: Store;
  secrets: SecretStore;
  navigate: (payload: AppNavigatePayload) => void;
  sendOpenPdf: (filePath: string) => Promise<void>;
  onQuit: () => void;
  ensureWindow: () => void | Promise<void>;
  version: string;
  pdfPath: (paperId: string) => string;
}

function ensureSubsTable(db: Store["db"]): void {
  db.exec("CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);");
}

function listSubs(store: Store): Record<string, unknown>[] {
  ensureSubsTable(store.db);
  const rows = store.db.prepare("SELECT payload FROM subscriptions").all() as Array<{ payload: string }>;
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    try { out.push(normalizeSubscription(JSON.parse(row.payload)) as Record<string, unknown>); } catch { /* skip */ }
  }
  return out;
}

function countSubsBadge(subs: Record<string, unknown>[]): number {
  return countSubsUnread(subs);
}

function formatAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

function latestSubRunIso(subs: Record<string, unknown>[]): string | null {
  let best = 0;
  for (const s of subs) {
    const t = s.lastRunAt ? new Date(String(s.lastRunAt)).getTime() : 0;
    if (!Number.isNaN(t) && t > best) best = t;
  }
  return best ? new Date(best).toISOString() : null;
}

function truncate(s: string, max: number): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

export function buildTraySnapshot(store: Store, getWin: () => BrowserWindow | null, pdfPath: (id: string) => string): TraySnapshot {
  const subs = listSubs(store);
  const metrics = getTrayMetrics();
  const w = getWin();
  const windowVisible = !!(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized());

  ensureReadingHistoryTable(store.db);
  const enrich = (row: ReadingHistoryRow) => {
    if (row.kind === "paper" && row.paper_id) {
      const hasPdf = fs.existsSync(pdfPath(row.paper_id));
      return { title: row.title, missing: !hasPdf, hasPdf };
    }
    if (row.kind === "local" && row.local_path) {
      const ok = isSafeLocalPdfPath(row.local_path);
      return { title: row.title, missing: !ok, hasPdf: ok };
    }
    return { title: row.title, missing: true, hasPdf: false };
  };
  const continueRows = listContinueReading(store.db, enrich, 5);
  const continueEntry = continueRows.find((e) => !e.missing) || null;

  return {
    unreadCount: countSubsBadge(subs),
    subCount: subs.length,
    enabledSubCount: subs.filter((s) => s.enabled !== false).length,
    lastRunAgo: formatAgo(latestSubRunIso(subs)),
    fetchPending: metrics.fetchQueue.pending,
    fetchActive: metrics.fetchQueue.active,
    searchInflight: metrics.searchInflight,
    subsBatchRunning: metrics.subsBatchRunning,
    continueEntry: continueEntry as Record<string, unknown> | null,
    windowVisible,
  };
}

function buildStatusLine(s: TraySnapshot): string {
  if (s.subsBatchRunning) return "正在检查全部订阅…";
  if (s.searchInflight > 0) return "正在检索…";
  const parts: string[] = ["本机就绪"];
  if (s.unreadCount > 0) parts.push(`${s.unreadCount} 篇待读`);
  else parts.push("暂无待读");
  if (s.enabledSubCount > 0) parts.push(`${s.enabledSubCount} 个订阅`);
  if (s.fetchActive > 0 || s.fetchPending > 0) {
    parts.push(`取文 ${s.fetchActive}${s.fetchPending ? ` · 排队 ${s.fetchPending}` : ""}`);
  }
  if (s.lastRunAgo) parts.push(`上次检索 ${s.lastRunAgo}`);
  return parts.join(" · ");
}

function buildTooltip(s: TraySnapshot): string {
  const base = "Lumina Feed";
  if (s.unreadCount > 0) return `${base} · ${s.unreadCount} 篇待读`;
  if (s.subsBatchRunning) return `${base} · 检查订阅中`;
  return base;
}

function showWindow(opts: TrayControllerOptions): void {
  const w = opts.getWin();
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  } else {
    void opts.ensureWindow();
  }
}

function hideWindow(opts: TrayControllerOptions): void {
  const w = opts.getWin();
  if (w && !w.isDestroyed()) w.hide();
}

export function rebuildTrayMenu(opts: TrayControllerOptions): TraySnapshot {
  const snapshot = buildTraySnapshot(opts.store, opts.getWin, opts.pdfPath);
  opts.tray.setToolTip(buildTooltip(snapshot));

  const continueTitle = snapshot.continueEntry?.title
    ? truncate(String(snapshot.continueEntry.title), 36)
    : null;

  const template: MenuItemConstructorOptions[] = [
    { label: buildStatusLine(snapshot), enabled: false },
    { type: "separator" },
    {
      label: snapshot.unreadCount > 0 ? `今日简报（${snapshot.unreadCount}）` : "今日简报",
      click: () => {
        showWindow(opts);
        opts.navigate({ view: "subs" });
      },
    },
    {
      label: continueTitle ? `继续阅读 · ${continueTitle}` : "继续阅读",
      enabled: !!snapshot.continueEntry,
      click: () => {
        if (!snapshot.continueEntry) return;
        showWindow(opts);
        opts.navigate({ view: "read", continueEntry: snapshot.continueEntry });
      },
    },
    {
      label: snapshot.subsBatchRunning ? "正在检查订阅…" : "立即检查全部订阅",
      enabled: !snapshot.subsBatchRunning && snapshot.enabledSubCount > 0,
      click: () => {
        showWindow(opts);
        opts.navigate({ view: "subs" });
        void runAllSubscriptionsNow(opts.store, opts.secrets).then(() => {
          rebuildTrayMenu(opts);
        });
      },
    },
    {
      label: "打开 PDF…",
      click: () => {
        void (async () => {
          const w = opts.getWin();
          const result = await dialog.showOpenDialog(w && !w.isDestroyed() ? w : undefined, {
            title: "打开 PDF",
            filters: [{ name: "PDF", extensions: ["pdf"] }],
            properties: ["openFile"],
          });
          if (result.canceled || !result.filePaths[0]) return;
          await opts.sendOpenPdf(result.filePaths[0]);
        })();
      },
    },
    { type: "separator" },
    {
      label: snapshot.windowVisible ? "隐藏主窗口" : "显示 Lumina",
      click: () => {
        if (snapshot.windowVisible) hideWindow(opts);
        else showWindow(opts);
        setTimeout(() => rebuildTrayMenu(opts), 80);
      },
    },
    {
      label: "设置",
      click: () => {
        showWindow(opts);
        opts.navigate({ view: "settings", settingsCat: "general" });
      },
    },
    {
      label: `关于 Lumina Feed ${opts.version}`,
      click: () => {
        const w = opts.getWin();
        void dialog.showMessageBox(w && !w.isDestroyed() ? w : undefined, {
          type: "info",
          title: "Lumina Feed",
          message: `Lumina Feed ${opts.version}`,
          detail: "Locate · Fetch · Illuminate\n文献检索 · 取文 · 接地总结",
          buttons: ["确定"],
        });
      },
    },
    { type: "separator" },
    {
      label: "退出 Lumina",
      click: () => opts.onQuit(),
    },
  ];

  opts.tray.setContextMenu(Menu.buildFromTemplate(template));
  return snapshot;
}

export function installTrayMenuController(opts: TrayControllerOptions): () => void {
  rebuildTrayMenu(opts);
  opts.tray.on("right-click", () => { rebuildTrayMenu(opts); });
  setTrayRefreshHook(() => { rebuildTrayMenu(opts); });
  const timer = setInterval(() => {
    const snap = buildTraySnapshot(opts.store, opts.getWin, opts.pdfPath);
    opts.tray.setToolTip(buildTooltip(snap));
  }, 45_000);
  return () => {
    clearInterval(timer);
    setTrayRefreshHook(() => {});
  };
}
