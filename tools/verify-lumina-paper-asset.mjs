#!/usr/bin/env node
/** verify · 统一 Paper Asset 层（fetch_log · hydrate · 队列 · 自动入库） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };

console.log("=== verify-lumina-paper-asset ===\n");

if (exists("src/core/store/paper-asset.ts")) {
  const s = read("src/core/store/paper-asset.ts");
  /ensurePaperAssetTables/.test(s) && /recordFetchLog/.test(s) && /fetch_log/.test(s) ? ok("paper-asset.ts 表与 record") : bad("paper-asset.ts 不完整");
  /recordLibraryDetach/.test(s) && /library_detach_log/.test(s) ? ok("library_detach_log 表") : bad("缺 library_detach_log");
} else bad("缺 src/core/store/paper-asset.ts");

if (exists("electron/paper-asset-ipc.ts")) {
  const s = read("electron/paper-asset-ipc.ts");
  /postFetchSuccess/.test(s) && /hydrateAssets/.test(s) && /reconcileOrphans/.test(s) && /enqueueFetch/.test(s) && /deleteLocalPdf/.test(s)
    && /listDetachedPdfs/.test(s) && /pruneDetachedPdfs/.test(s) && /detachFromLibrary/.test(s)
    ? ok("paper-asset-ipc 核心函数") : bad("paper-asset-ipc 不完整");
  /isLibraryDetached/.test(s) ? ok("reconcile 尊重 library_detach_log") : bad("reconcile 未跳过 detached");
  (/FETCH_CONCURRENCY = 2/.test(s) || (/FETCH_CONCURRENCY_IDLE = 2/.test(s) && /fetchConcurrencyLimit/.test(s)))
    ? ok("取文队列并发上限 2") : bad("缺队列并发限制");
  /importLocalPdfToLibrary/.test(s) && /lookupImportedPaperId/.test(s) ? ok("本地 PDF 导入工作集") : bad("缺 importLocalPdfToLibrary");
  /assertSafePaperId/.test(s) && /ensureStubPaper/.test(s) ? ok("paperId 校验 + stub 入库") : bad("缺 assertSafePaperId 或 ensureStubPaper");
} else bad("缺 electron/paper-asset-ipc.ts");

if (exists("electron/ipc.ts")) {
  const s = read("electron/ipc.ts");
  [["papers:hydrate", 1], ["papers:reconcile", 1], ["papers:asset", 1], ["pdf:delete", 1], ["pdf:listDetached", 1], ["pdf:pruneDetached", 1], ["papers:enqueueFetch", 1], ["papers:fetchQueueStatus", 1]].forEach(([h]) => {
    s.includes(`"${h}"`) ? ok("IPC " + h) : bad("缺 IPC " + h);
  });
  /postFetchSuccess/.test(s) && /getFetchLog/.test(s) ? ok("runFetchPaper 接 postFetch") : bad("runFetchPaper 未接 postFetch");
  /"library:importLocal"/.test(s) ? ok("IPC library:importLocal") : bad("缺 IPC library:importLocal");
  /readSummaryText/.test(s) && /syncReaderSummaryToSummaries/.test(s) ? ok("阅读总结同步工作集") : bad("缺阅读总结同步");
} else bad("缺 electron/ipc.ts");

if (exists("electron/preload.ts")) {
  const s = read("electron/preload.ts");
  /papersHydrate/.test(s) && /onPapersChanged/.test(s) && /onFetchQueue/.test(s) && /pdfDelete/.test(s)
    ? ok("preload 暴露 asset API") : bad("preload 未暴露 asset API");
  /fetchPaperStream.*ctx/.test(s.replace(/\s+/g, " ")) || /fetchPaperStream\(paperId.*ctx/.test(s)
    ? ok("fetchPaperStream 传 ctx") : bad("fetchPaperStream 未传 ctx");
} else bad("缺 preload.ts");

if (exists("electron/settings.ts")) {
  /autoIngestOnFetch/.test(read("electron/settings.ts")) ? ok("settings autoIngestOnFetch") : bad("settings 缺 autoIngestOnFetch");
} else bad("缺 settings.ts");

if (exists("src/ui/lumina-bridge.js")) {
  const s = read("src/ui/lumina-bridge.js");
  /hydratePaperAssets/.test(s) && /enqueueFetch/.test(s) && /onPapersChanged/.test(s) && /pdfDelete/.test(s)
    ? ok("bridge asset 桥接") : bad("bridge 缺 asset 桥接");
  /fetchFullText\(card, onProgress, ctx/.test(s.replace(/\s+/g, " ")) || /fetchCtx/.test(s)
    ? ok("fetchFullText 传 provenance") : bad("fetchFullText 未传 ctx");
} else bad("缺 lumina-bridge.js");

if (exists("src/ui/LuminaApp.jsx")) {
  const s = read("src/ui/LuminaApp.jsx");
  /hydrateFetchedMeta/.test(s) && /paperHasFull/.test(s) && /onFetchBatch/.test(s) && /onPapersChanged/.test(s)
    ? ok("LuminaApp hydration/阅读/队列") : bad("LuminaApp 缺 hydration 或阅读修复");
  /deletePdf/.test(s) ? ok("LuminaApp 删 PDF 语义") : bad("LuminaApp 缺删 PDF");
} else bad("缺 LuminaApp.jsx");

if (exists("src/ui/modules/Library.jsx")) {
  const s = read("src/ui/modules/Library.jsx");
  /onFetch/.test(s) && /获取全文/.test(s) && /删 PDF/.test(s) ? ok("Library 取文+删 PDF") : bad("Library 未更新");
} else bad("缺 Library.jsx");

if (exists("src/ui/modules/Subscriptions.jsx")) {
  const s = read("src/ui/modules/Subscriptions.jsx");
  /onFetchBatch/.test(s) && /fetchOpts/.test(s) && /subscription:/.test(s) ? ok("Subscriptions provenance/批量队列") : bad("Subscriptions 未更新");
} else bad("缺 Subscriptions.jsx");

if (exists("src/ui/modules/ReadHub.jsx")) {
  const s = read("src/ui/modules/ReadHub.jsx");
  /onAddToLibrary/.test(s) && /工作集/.test(s) ? ok("ReadHub 加入工作集") : bad("ReadHub 未更新");
} else bad("缺 ReadHub.jsx");

if (exists("src/ui/fetch-meta.js")) {
  /metaFromAsset/.test(read("src/ui/fetch-meta.js")) ? ok("metaFromAsset") : bad("fetch-meta 缺 metaFromAsset");
} else bad("缺 fetch-meta.js");

if (exists("src/ui/modules/Settings.jsx")) {
  /autoIngest/.test(read("src/ui/modules/Settings.jsx")) ? ok("Settings 自动入库开关") : bad("Settings 缺自动入库");
} else bad("缺 Settings.jsx");

if (exists("electron/main.ts")) {
  const s = read("electron/main.ts");
  const ri = s.indexOf("registerIpc");
  const cw = s.indexOf("await createWindow");
  ri >= 0 && cw >= 0 && ri < cw ? ok("main.ts IPC 先于 createWindow") : bad("main.ts IPC 注册晚于窗口加载");
} else bad("缺 electron/main.ts");

console.log(`\n=== verify: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
