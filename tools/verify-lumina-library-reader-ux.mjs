#!/usr/bin/env node
/** verify · 文献导入题名 · 阅读台收藏切换 · 连续模式页码跳转 · 订阅后台说明 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };

console.log("=== verify-lumina-library-reader-ux ===\n");

const localImport = read("src/core/store/local-import.ts");
/isGarbledTitle/.test(localImport) && /resolveImportTitle/.test(localImport)
  ? ok("local-import 题名仅用文件名") : bad("local-import 题名逻辑缺失");

const ipc = read("electron/paper-asset-ipc.ts");
/titleFromFilename\(opts\.title/.test(ipc) && !/guessTitleFromPdf/.test(ipc)
  ? ok("paper-asset-ipc 导入不跑 PDF 题名抽取") : bad("paper-asset-ipc 仍抽取题名");

const bridge = read("src/ui/lumina-bridge.js");
/libraryImportPayload/.test(bridge) && /opts\.localPath\) return payload/.test(bridge)
  ? ok("bridge 有 localPath 时不传 bytes") : bad("bridge 未规避 IPC 克隆失败");

const reader = read("src/ui/modules/Reader.jsx");
/source\.paperId[\s\S]{0,120}onLibraryImport\(\{ paperId: source\.paperId/.test(reader)
  ? ok("Reader 已有 paperId 时快速重新入库") : bad("Reader 重加仍走全量导入");
/res\.paperId !== source\.paperId/.test(reader)
  ? ok("Reader 重加不重复 onSourceUpgrade") : bad("Reader 重加仍会触发 onSourceUpgrade");
/resolveReaderPdfData/.test(reader) && /readPdf/.test(reader)
  ? ok("Reader PDF 失效缓冲时从盘读回") : bad("Reader 缺 PDF 读盘回退");
/onLibraryRemove/.test(reader) && /scrollItemInContainer\(container, el\)/.test(reader) && /点击移出文献/.test(reader)
  ? ok("Reader 收藏切换 + 连续模式容器内滚动") : bad("Reader UX 修复不完整");

const hub = read("src/ui/modules/ReadHub.jsx");
/onImportLocalDone/.test(hub) && /已在文献/.test(hub) && /patchContinueAfterImport/.test(hub)
  ? ok("ReadHub 导入后状态刷新") : bad("ReadHub 导入反馈缺失");

const app = read("src/ui/LuminaApp.jsx");
/onLibraryRemove/.test(app) ? ok("LuminaApp 接 onLibraryRemove") : bad("LuminaApp 未接 onLibraryRemove");

const subs = read("src/ui/modules/Subscriptions.jsx");
/subsBackgroundHintDismissed/.test(subs) && /最小化到托盘/.test(subs) && !/settingsGet/.test(subs)
  ? ok("Subscriptions 首次订阅后台说明横幅") : bad("Subscriptions 后台说明缺失或 API 错误");

const settings = read("electron/settings.ts");
/subsBackgroundHintDismissed/.test(settings) ? ok("settings prompts 键") : bad("settings 缺 subsBackgroundHintDismissed");

try {
  const { isJournalMastheadLine, isGarbledTitle, titleFromFilename, resolveImportTitle, titleQualityScore } = await import("../src/core/store/local-import.ts");
  isGarbledTitle("þÿR o b u s t estimation") ? ok("乱码题名识别") : bad("乱码未识别");
  !isGarbledTitle("Robust estimation of cortical networks") ? ok("正常题名不误判乱码") : bad("正常题名误判");
  isJournalMastheadLine("Nature Neuroscience | Volume 26 | August 2023") ? ok("页眉行识别") : bad("页眉行未识别");
  !isJournalMastheadLine("Robust estimation of individual-level brain connectivity") ? ok("真实题名不误判") : bad("真实题名被误判为页眉");
  const fromFile = titleFromFilename("Smith_2024_neural_dynamics.pdf");
  fromFile.includes("Smith") ? ok("文件名题名") : bad("文件名题名失败");
  const impTitle = resolveImportTitle(new Uint8Array(0), "Sebenius2023_MIND_NatNeurosci.pdf");
  impTitle.includes("Sebenius2023") ? ok("resolveImportTitle 仅用文件名") : bad("resolveImportTitle 未仅用文件名");
} catch (e) {
  bad("local-import 运行时: " + (e && e.message));
}

console.log(`\n=== verify: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
