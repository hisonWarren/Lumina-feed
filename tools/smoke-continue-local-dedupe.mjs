#!/usr/bin/env node
/** 真机烟测：本地 PDF 入库后继续阅读去重 + 「本机」标签（CDP 9222） */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); process.exitCode = 1; };

async function getWsUrl() {
  const page = (await (await fetch(`${CDP}/json/list`)).json()).find(
    (t) => t.type === "page" && /index\.html/.test(t.url || ""),
  );
  if (!page) throw new Error("Electron CDP 9222 未就绪");
  return page.webSocketDebuggerUrl;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("open", () => resolve({ ws, send }));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    function send(method, params = {}) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
  });
}

async function evalJs(cdp, expr) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

console.log("\n── smoke-continue-local-dedupe ──\n");

const pdfPath = path.join(os.tmpdir(), `lumina-smoke-${Date.now()}.pdf`);
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
fs.writeFileSync(pdfPath, pdfBytes);

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
} catch (e) {
  console.log("  CDP 不可用:", e.message);
  console.log("  请先: cd lumina-feed && npm run build:electron && npx electron . --remote-debugging-port=9222");
  try { fs.unlinkSync(pdfPath); } catch { /* ignore */ }
  process.exit(2);
}

let paperId = null;
try {
  const localPathJson = JSON.stringify(pdfPath);
  const bytesArr = [...pdfBytes];

  // 1) 模拟先打开本地 PDF → local 继续阅读行
  const recLocal = await evalJs(cdp, `
    const p = ${localPathJson};
    return await window.luminaReader.recordOpen({ localPath: p, title: "smoke-local.pdf", page: 1 });
  `);
  recLocal?.ok ? pass("recordOpen local") : fail("recordOpen local", JSON.stringify(recLocal));

  const beforeImport = await evalJs(cdp, `return await window.luminaReader.continueList();`);
  const localRows = (beforeImport || []).filter((e) => e.localPath && e.localPath.includes("lumina-smoke"));
  localRows.length >= 1 ? pass("继续阅读含 local 行", `${localRows.length} 条`) : fail("缺 local 行", JSON.stringify(beforeImport?.slice(0, 3)));

  // 2) 导入工作集（应晋升 paper 并清除 local）
  const imp = await evalJs(cdp, `
    const bytes = new Uint8Array(${JSON.stringify(bytesArr)});
    return await window.luminaApi.libraryImportLocal({
      bytes,
      localPath: ${localPathJson},
      title: "Smoke Local Import Title",
      addToLibrary: true,
    });
  `);
  if (!imp?.ok || !imp.paperId) fail("libraryImportLocal", JSON.stringify(imp));
  else { pass("libraryImportLocal", imp.paperId); paperId = imp.paperId; }

  const afterImport = await evalJs(cdp, `
    return await window.luminaReader.continueList();
  `);
  const paperRows = (afterImport || []).filter((e) => e.paperId === paperId);
  const dupLocal = (afterImport || []).filter((e) => e.kind === "local" && (e.localPath || "").includes("lumina-smoke"));
  if (paperRows.length === 1 && dupLocal.length === 0) {
    pass("导入后无重复 local 行", `paper 行 1 条`);
  } else {
    fail("导入后仍重复", `paper=${paperRows.length} local=${dupLocal.length}`);
  }

  const prov = paperRows[0]?.provenance;
  if (prov === "local_import") pass("继续阅读 provenance", prov);
  else fail("provenance 非 local_import", String(prov));

  // 3) UI 标签应为「本机」
  await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("阅读"));
    if (tab) tab.click();
    await new Promise(r => setTimeout(r, 500));
    const home = document.querySelector(".rhx-home");
    if (home) home.click();
    await new Promise(r => setTimeout(r, 600));
    return true;
  `);
  const tags = await evalJs(cdp, `
    return [...document.querySelectorAll(".rh-tag")].map(el => el.textContent.trim());
  `);
  if (tags.includes("本机") && !tags.filter(t => t === "已下载").length) {
    pass("ReadHub 标签显示本机", tags.join(" · "));
  } else if (tags.includes("本机")) {
    pass("ReadHub 含本机标签", tags.join(" · "));
  } else {
    fail("ReadHub 标签", tags.join(" · ") || "(无标签)");
  }

  // 4) 重命名后仍单条 + 标题更新
  const newTitle = "Smoke Renamed Interoception Title";
  await evalJs(cdp, `
    return await window.luminaApi.papersUpdateTitle(${JSON.stringify(paperId)}, ${JSON.stringify(newTitle)});
  `);
  const afterRename = await evalJs(cdp, `return await window.luminaReader.continueList();`);
  const renamed = (afterRename || []).filter((e) => e.paperId === paperId);
  if (renamed.length === 1 && (renamed[0].title || "").includes("Smoke Renamed")) {
    pass("重命名后继续阅读单条且标题同步", renamed[0].title.slice(0, 40));
  } else {
    fail("重命名后重复或标题未同步", JSON.stringify(renamed));
  }
} catch (e) {
  fail("真机烟测异常", e.message);
} finally {
  cdp.ws.close();
  try {
    if (paperId) {
      // cleanup via separate electron instance not possible; leave test paper in user db — acceptable for smoke
    }
    fs.unlinkSync(pdfPath);
  } catch { /* ignore */ }
}

console.log("\n── done ──\n");
process.exit(process.exitCode || 0);
