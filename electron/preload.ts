// lumina-feed · preload（干净基线 API）
import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld("luminaApi", {
  searchOnline: (raw: string, filters?: unknown) => invoke("search:online", raw, filters),
  summarizePaper: (paperId: string, opts: unknown) => invoke("summarize:paper", paperId, opts),
  getSettings: () => invoke("settings:get"),
  saveSettings: (s: unknown) => invoke("settings:save", s),
  setSecret: (key: string, value: string) => invoke("secrets:set", key, value),
  testLlm: (cfg) => invoke("llm:test", cfg),
  listModels: (cfg) => invoke("llm:listModels", cfg),
  onOpenLocalPdf: (cb: (payload: { name: string; data: ArrayBuffer }) => void) => { ipcRenderer.on("open-local-pdf", (_e, payload) => cb(payload)); },
  setBackground: (opts: { minimizeToTray?: boolean; openAtLogin?: boolean }) => invoke("app:setBackground", opts),
  searchOnlineStream: (raw: string, filters: unknown, reqId: number, cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: any) => { if (payload && payload.reqId === reqId) cb(payload); };
    ipcRenderer.on("search:stream", handler);
    ipcRenderer.invoke("search:online-stream", raw, filters, reqId).catch(() => {});
    return () => ipcRenderer.removeListener("search:stream", handler);
  },
  openExternal: (url: string) => invoke("shell:openExternal", url),
  subsList: () => invoke("subs:list"),
  subsGet: (id: string) => invoke("subs:get", id),
  subsSave: (sub: unknown) => invoke("subs:save", sub),
  subsRemove: (id: string) => invoke("subs:remove", id),
  subsRunNow: (sub: unknown) => invoke("subs:runNow", sub),
  libraryList: () => invoke("library:list"),
  libraryAdd: (paperId: string, provenance?: string) => invoke("library:add", paperId, provenance),
  libraryRemove: (paperId: string) => invoke("library:remove", paperId),
  listsGet: () => invoke("lists:get"),
  listsSave: (lists: unknown) => invoke("lists:save", lists),
  fulltextSave: (paperId: string, text: string) => invoke("fulltext:save", paperId, text),
  searchLocal: (query: string) => invoke("search:local", query),
});

contextBridge.exposeInMainWorld("luminaOa", {
  resolve: (paperId: string) => invoke("oa:resolve", paperId),
  fetchPaper: (paperId: string) => invoke("oa:fetchPaper", paperId),
  fetchPdf: (url: string, paperId?: string) => invoke("oa:fetchPdf", url, paperId),
  readPdf: (paperId: string) => invoke("oa:readPdf", paperId),
  listPdfs: () => invoke("oa:listPdfs"),
});

contextBridge.exposeInMainWorld("luminaReader", {
  summarize: (payload: unknown) => invoke("reader:summarize", payload),
  ask: (payload: unknown) => invoke("reader:ask", payload),
  translate: (payload: unknown) => invoke("reader:translate", payload),
  analyze: (kind, pages, opts) => invoke("reader:analyze", { kind, pages, text: opts && opts.text, page: opts && opts.page }),
  swipeGet: () => invoke("swipe:get"),
  swipeSave: (item) => invoke("swipe:save", item),
  swipeRemove: (id) => invoke("swipe:remove", id),
  practiceSave: (paperId, kind, text) => invoke("reader:practiceSave", paperId, kind, text),
  figure: (dataUrl, caption) => invoke("reader:figure", { dataUrl, caption }),
  corpus: (kind, paperIds) => invoke("reader:corpus", { kind, paperIds }),
  analysisGet: (paperId, kind) => invoke("reader:analysisGet", paperId, kind),
  analysisSave: (paperId, env) => invoke("reader:analysisSave", paperId, env),
  getTranslations: (docKey: string) => invoke("translations:get", docKey),
  saveTranslation: (docKey: string, page: number, model: string, text: string) => invoke("translations:save", docKey, page, model, text),
  getNavmarks: (docKey: string) => invoke("navmarks:get", docKey),
  saveNavmarks: (docKey: string, pages: number[]) => invoke("navmarks:save", docKey, pages),
});

contextBridge.exposeInMainWorld("luminaAnno", {
  get: (docKey: string) => invoke("annotations:get", docKey),
  save: (docKey: string, list: unknown) => invoke("annotations:save", docKey, list),
});
