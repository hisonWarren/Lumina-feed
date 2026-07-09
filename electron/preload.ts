// lumina-feed · preload（干净基线 API）
import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

type OpenLocalPdfPayload = { name: string; data: ArrayBuffer; localPath?: string };
let pendingOpenLocalPdf: OpenLocalPdfPayload | null = null;
let openLocalPdfHandler: ((payload: OpenLocalPdfPayload) => void) | null = null;
ipcRenderer.on("open-local-pdf", (_e, payload: OpenLocalPdfPayload) => {
  if (openLocalPdfHandler) {
    try { openLocalPdfHandler(payload); } catch { /* ignore */ }
  } else {
    pendingOpenLocalPdf = payload;
  }
});

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
  deleteSecret: (key: string) => invoke("secrets:delete", key),
  testLlm: (cfg) => invoke("llm:test", cfg),
  listModels: (cfg) => invoke("llm:listModels", cfg),
  modelCatalogGet: () => invoke("modelCatalog:get"),
  modelCatalogRefresh: () => invoke("modelCatalog:refresh"),
  llmStatus: () => invoke("llm:status"),
  onOpenLocalPdf: (cb: (payload: OpenLocalPdfPayload) => void) => {
    openLocalPdfHandler = cb;
    if (pendingOpenLocalPdf) {
      const p = pendingOpenLocalPdf;
      pendingOpenLocalPdf = null;
      try { cb(p); } catch { /* ignore */ }
    }
  },
  setBackground: (opts: { minimizeToTray?: boolean; openAtLogin?: boolean }) => invoke("app:setBackground", opts),
  resetLocalData: () => invoke("app:resetLocalData"),
  getUserDataPath: () => invoke("app:getUserDataPath"),
  pdfGetStorageInfo: () => invoke("pdf:getStorageInfo"),
  pdfPickStorageDir: () => invoke("pdf:pickStorageDir"),
  pdfSetStorageDir: (opts: unknown) => invoke("pdf:setStorageDir", opts),
  pdfOpenStorageDir: () => invoke("pdf:openStorageDir"),
  getAppVersion: () => invoke("app:getVersion"),
  pullPendingOpenPdf: () => invoke("app:pullPendingOpenPdf"),
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
    ipcRenderer.invoke("search:online-stream", raw, filters, reqId).catch(() => {
      cb({ reqId, done: true, resolveError: "stream_start_failed", papers: [] });
    });
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
  subsRunAllNow: () => invoke("subs:runAllNow"),
  subsMarkRead: (paperId: string, subIds?: string[]) => invoke("subs:markRead", paperId, subIds),
  subsMarkAllRead: (scopeSubId?: string) => invoke("subs:markAllRead", scopeSubId),
  subsPreview: (draft: unknown) => invoke("subs:preview", draft),
  digestReportGet: (scope?: string) => invoke("digestReport:get", scope),
  digestReportGenerate: (opts?: unknown) => invoke("digestReport:generate", opts),
  digestHistoryDates: (scope?: string) => invoke("digestHistory:dates", scope),
  digestHistoryGet: (dateKey: string, scope?: string) => invoke("digestHistory:get", dateKey, scope),
  digestRetroSeries: (opts?: unknown) => invoke("digestRetro:series", opts),
  digestRetroAnalyze: (opts?: unknown) => invoke("digestRetro:analyze", opts),
  digestHistoryPurge: () => invoke("digestHistory:purge"),
  onDigestReportUpdated: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("digest:reportUpdated", handler);
    return () => ipcRenderer.removeListener("digest:reportUpdated", handler);
  },
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
  onSubsBatchProgress: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("subs:batchProgress", handler);
    return () => ipcRenderer.removeListener("subs:batchProgress", handler);
  },
  onAppNavigate: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("app:navigate", handler);
    return () => ipcRenderer.removeListener("app:navigate", handler);
  },
  getCachedSummary: (paperId: string, depth?: string, language?: string) => invoke("summaries:get", paperId, depth, language),
  libraryList: () => invoke("library:list"),
  libraryAdd: (paperId: string, provenance?: string) => invoke("library:add", paperId, provenance),
  libraryImportLocal: (payload: unknown) => invoke("library:importLocal", payload),
  libraryRemove: (paperId: string) => invoke("library:remove", paperId),
  listsGet: () => invoke("lists:get"),
  listsSave: (lists: unknown) => invoke("lists:save", lists),
  fulltextSave: (paperId: string, text: string) => invoke("fulltext:save", paperId, text),
  searchLocal: (query: string) => invoke("search:local", query),
  papersHydrate: () => invoke("papers:hydrate"),
  papersReconcile: () => invoke("papers:reconcile"),
  papersAsset: (paperId: string) => invoke("papers:asset", paperId),
  papersUpdateTitle: (paperId: string, title: string) => invoke("papers:updateTitle", paperId, title),
  pdfDelete: (paperId: string, opts?: unknown) => invoke("pdf:delete", paperId, opts),
  pdfListDetached: () => invoke("pdf:listDetached"),
  pdfPruneDetached: (paperIds?: string[]) => invoke("pdf:pruneDetached", paperIds),
  papersEnqueueFetch: (jobs: unknown) => invoke("papers:enqueueFetch", jobs),
  papersFetchQueueStatus: () => invoke("papers:fetchQueueStatus"),
  onPapersChanged: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("papers:changed", handler);
    return () => ipcRenderer.removeListener("papers:changed", handler);
  },
  onSettingsChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
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
  schedulePrefetch: (paperId: string, opts?: { priority?: string }) => invoke("oa:schedulePrefetch", paperId, opts),
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

contextBridge.exposeInMainWorld("luminaJournal", {
  search: (query: string) => invoke("journal:search", query),
  liveMetrics: (issns: string[]) => invoke("journal:liveMetrics", issns),
  datasets: () => invoke("journal:datasets"),
  updateScimago: () => invoke("journal:updateScimago"),
  importScimago: (text: string) => invoke("journal:importScimago", text),
  updateJif: () => invoke("journal:updateJif"),
  importJif: (text: string) => invoke("journal:importJif", text),
  updateCas: () => invoke("journal:updateCas"),
  importCas: (text: string) => invoke("journal:importCas", text),
  updateWarningUrl: (url: string) => invoke("journal:updateWarningUrl", url),
  importWarning: (text: string) => invoke("journal:importWarning", text),
  structureWarningText: (text: string) => invoke("journal:structureWarningText", text),
  onJifProgress: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("journal:jifProgress", handler);
    return () => ipcRenderer.removeListener("journal:jifProgress", handler);
  },
  onCasProgress: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("journal:casProgress", handler);
    return () => ipcRenderer.removeListener("journal:casProgress", handler);
  },
});

contextBridge.exposeInMainWorld("luminaReader", {
  summarize: (payload: unknown) => invoke("reader:summarize", payload),
  ask: (payload: unknown) => invoke("reader:ask", payload),
  translate: (payload: unknown) => invoke("reader:translate", payload),
  analyze: (kind, pages, opts) => invoke("reader:analyze", { kind, pages, text: opts && opts.text, page: opts && opts.page, speculative: !!(opts && opts.speculative) }),
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
