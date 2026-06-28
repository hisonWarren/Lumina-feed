// lumina-feed · preload（干净基线 API）
import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld("luminaApi", {
  searchOnline: (raw: string, filters?: unknown) => invoke("search:online", raw, filters),
  resolveIdentifier: (raw: string) => invoke("search:resolve-identifier", raw),
  searchRetrySource: (sourceId: string, raw: string, filters?: unknown) =>
    invoke("search:retry-source", sourceId, raw, filters),
  summarizePaper: (paperId: string, opts: unknown) => invoke("summarize:paper", paperId, opts),
  getSettings: () => invoke("settings:get"),
  saveSettings: (s: unknown) => invoke("settings:save", s),
  setSecret: (key: string, value: string) => invoke("secrets:set", key, value),
  secretHas: (key: string) => invoke("secrets:has", key),
  testLlm: (cfg) => invoke("llm:test", cfg),
  listModels: (cfg) => invoke("llm:listModels", cfg),
  llmStatus: () => invoke("llm:status"),
  onOpenLocalPdf: (cb: (payload: { name: string; data: ArrayBuffer }) => void) => { ipcRenderer.on("open-local-pdf", (_e, payload) => cb(payload)); },
  setBackground: (opts: { minimizeToTray?: boolean; openAtLogin?: boolean }) => invoke("app:setBackground", opts),
  resetLocalData: () => invoke("app:resetLocalData"),
  getUserDataPath: () => invoke("app:getUserDataPath"),
  platform: process.platform,
  onContextMenu: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("lumina:context-menu", handler);
    return () => ipcRenderer.removeListener("lumina:context-menu", handler);
  },
  contextAction: (action: string, extra?: string) => invoke("lumina:context-action", action, extra),
  searchOnlineStream: (raw: string, filters: unknown, reqId: number, cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: any) => { if (payload && payload.reqId === reqId) cb(payload); };
    ipcRenderer.on("search:stream", handler);
    ipcRenderer.invoke("search:online-stream", raw, filters, reqId).catch(() => {});
    return () => ipcRenderer.removeListener("search:stream", handler);
  },
  openExternal: (url: string) => invoke("shell:openExternal", url),
  sourcesStatus: () => invoke("sources:status"),
  sourcesRegistry: () => invoke("sources:registry"),
  testSource: (secretName: string, candidate?: string) => invoke("sources:test", secretName, candidate),
  exportCitation: (items: unknown, fmt: string) => invoke("cite:export", items, fmt),
  subsList: () => invoke("subs:list"),
  subsGet: (id: string) => invoke("subs:get", id),
  subsSave: (sub: unknown) => invoke("subs:save", sub),
  subsRemove: (id: string) => invoke("subs:remove", id),
  subsRunNow: (sub: unknown, opts?: unknown) => invoke("subs:runNow", sub, opts),
  subsPreview: (draft: unknown) => invoke("subs:preview", draft),
  onSubsProgress: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("subs:progress", handler);
    return () => ipcRenderer.removeListener("subs:progress", handler);
  },
  onSubsUpdated: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("subs:updated", handler);
    return () => ipcRenderer.removeListener("subs:updated", handler);
  },
  getCachedSummary: (paperId: string, depth?: string, language?: string) => invoke("summaries:get", paperId, depth, language),
  libraryList: () => invoke("library:list"),
  libraryAdd: (paperId: string, provenance?: string) => invoke("library:add", paperId, provenance),
  libraryRemove: (paperId: string) => invoke("library:remove", paperId),
  listsGet: () => invoke("lists:get"),
  listsSave: (lists: unknown) => invoke("lists:save", lists),
  fulltextSave: (paperId: string, text: string) => invoke("fulltext:save", paperId, text),
  searchLocal: (query: string) => invoke("search:local", query),
  papersHydrate: () => invoke("papers:hydrate"),
  papersReconcile: () => invoke("papers:reconcile"),
  papersAsset: (paperId: string) => invoke("papers:asset", paperId),
  pdfDelete: (paperId: string, opts?: unknown) => invoke("pdf:delete", paperId, opts),
  papersEnqueueFetch: (jobs: unknown) => invoke("papers:enqueueFetch", jobs),
  papersFetchQueueStatus: () => invoke("papers:fetchQueueStatus"),
  onPapersChanged: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("papers:changed", handler);
    return () => ipcRenderer.removeListener("papers:changed", handler);
  },
  onFetchQueue: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("fetch:queue", handler);
    return () => ipcRenderer.removeListener("fetch:queue", handler);
  },
});

contextBridge.exposeInMainWorld("luminaOa", {
  resolve: (paperId: string) => invoke("oa:resolve", paperId),
  fetchPaper: (paperId: string, ctx?: unknown) => invoke("oa:fetchPaper", paperId, ctx),
  fetchPaperStream: (paperId: string, reqId: number, cb: (p: unknown) => void, ctx?: unknown) => {
    const handler = (_e: unknown, payload: any) => { if (payload && payload.reqId === reqId) cb(payload); };
    ipcRenderer.on("fetch:progress", handler);
    ipcRenderer.invoke("oa:fetchPaper-stream", paperId, reqId, ctx).catch(() => {});
    return () => ipcRenderer.removeListener("fetch:progress", handler);
  },
  fetchPdf: (url: string, paperId?: string) => invoke("oa:fetchPdf", url, paperId),
  readPdf: (paperId: string) => invoke("oa:readPdf", paperId),
  listPdfs: () => invoke("oa:listPdfs"),
  probeMirrors: () => invoke("mirrors:probe"),
  onPrefetchStart: (cb: (payload: { paperId: string }) => void) => {
    const handler = (_e: unknown, payload: { paperId: string }) => cb(payload);
    ipcRenderer.on("prefetch:start", handler);
    return () => ipcRenderer.removeListener("prefetch:start", handler);
  },
  onPrefetchDone: (cb: (payload: { paperId: string; result: unknown }) => void) => {
    const handler = (_e: unknown, payload: { paperId: string; result: unknown }) => cb(payload);
    ipcRenderer.on("prefetch:done", handler);
    return () => ipcRenderer.removeListener("prefetch:done", handler);
  },
  onPrefetchFail: (cb: (payload: { paperId: string; result: unknown }) => void) => {
    const handler = (_e: unknown, payload: { paperId: string; result: unknown }) => cb(payload);
    ipcRenderer.on("prefetch:fail", handler);
    return () => ipcRenderer.removeListener("prefetch:fail", handler);
  },
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
  continueList: () => invoke("reader:continueList"),
  recordOpen: (payload: { paperId?: string; localPath?: string; title?: string; page?: number }) =>
    invoke("reader:recordOpen", payload),
  recordPage: (entryKey: string, page: number) => invoke("reader:recordPage", entryKey, page),
  readLocalPdf: (localPath: string) => invoke("reader:readLocalPdf", localPath),
  removeContinue: (entryKey: string) => invoke("reader:removeContinue", entryKey),
  clearContinue: () => invoke("reader:clearContinue"),
});

contextBridge.exposeInMainWorld("luminaAnno", {
  get: (docKey: string) => invoke("annotations:get", docKey),
  save: (docKey: string, list: unknown) => invoke("annotations:save", docKey, list),
});
