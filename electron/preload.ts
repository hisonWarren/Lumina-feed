// lumina-feed · preload（contextBridge 暴露受控 API；保持 contextIsolation）
import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);
const on = (ch: string, cb: (...a: any[]) => void) => { const h = (_e: unknown, ...a: any[]) => cb(...a); ipcRenderer.on(ch, h); return () => ipcRenderer.off(ch, h); };

contextBridge.exposeInMainWorld("luminaApi", {
  // 检索
  searchLocal: (spec: unknown, opts?: unknown) => invoke("search:local", spec, opts),
  searchOnline: (raw: string, filters?: unknown) => invoke("search:online", raw, filters),
  // 订阅
  subsList: () => invoke("subs:list"),
  subsGet: (id: string) => invoke("subs:get", id),
  subsSave: (sub: unknown) => invoke("subs:save", sub),
  subsRemove: (id: string) => invoke("subs:remove", id),
  subsRunNow: (id: string) => invoke("subs:runNow", id),
  // 总结(带 grounding) + 人工 screening
  summarizePaper: (paperId: string, opts: unknown) => invoke("summarize:paper", paperId, opts),
  setState: (paperId: string, patch: unknown) => invoke("state:set", paperId, patch),
  // 导出 / 统计
  exportPapers: (ids: string[], format: string) => invoke("export:papers", ids, format),
  statsTrends: (ids: string[]) => invoke("stats:trends", ids),
  // 设置 / 密钥 / 调度
  getSettings: () => invoke("settings:get"),
  saveSettings: (s: unknown) => invoke("settings:save", s),
  setSecret: (key: string, value: string) => invoke("secrets:set", key, value),
  tick: () => invoke("scheduler:tick"),
  // 事件订阅
  onDigestResult: (cb: (r: unknown) => void) => on("digest-result", cb),
  onOpenDigest: (cb: (subId: string) => void) => on("open-digest", cb),
});

// M3：合法 OA PDF 桥（渲染侧抓取经主进程，绕 CORS + 守门）
contextBridge.exposeInMainWorld("luminaOa", {
  resolve: (paperId: string) => invoke("oa:resolve", paperId),
  fetchPdf: (url: string) => invoke("oa:fetchPdf", url),
});

// issue5：自定义无边框标题栏的窗口控制
contextBridge.exposeInMainWorld("luminaWin", {
  minimize: () => invoke("win:minimize"),
  maximize: () => invoke("win:maximize"),
  close: () => invoke("win:close"),
  isMaximized: () => invoke("win:isMaximized"),
  onMaximizeChange: (cb: (m: boolean) => void) => on("win:maximized", cb),
});
