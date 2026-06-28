#!/usr/bin/env node
/** 烟测 · Paper Asset 生命周期：hydrate · library 阅读 · fetch_log */
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); process.exitCode = 1; };
const skip = (n, d = "") => console.log(`  ○ ${n}${d ? " — " + d : ""}`);

async function getWsUrl() {
  const r = await fetch(`${CDP}/json/list`);
  const list = await r.json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
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

console.log("\n── smoke-paper-lifecycle ──\n");

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
} catch (e) {
  console.log("  CDP 不可用:", e.message);
  console.log("  请先: cd lumina-feed && npm start -- --remote-debugging-port=9222");
  process.exit(2);
}

try {
  const hasApi = await evalJs(cdp, `return !!(window.luminaApi && window.luminaApi.papersHydrate);`);
  hasApi ? pass("papersHydrate API") : fail("papersHydrate API");

  const assets = await evalJs(cdp, `return await window.luminaApi.papersHydrate();`);
  assets && typeof assets === "object" ? pass("papers:hydrate", `${Object.keys(assets).length} 条`) : fail("papers:hydrate");

  const recon = await evalJs(cdp, `return await window.luminaApi.papersReconcile();`);
  typeof recon?.added === "number" ? pass("papers:reconcile", `added=${recon.added}`) : fail("papers:reconcile");

  const pdfs = await evalJs(cdp, `return await window.luminaOa.listPdfs();`);
  Array.isArray(pdfs) ? pass("listPdfs", `${pdfs.length} PDF`) : fail("listPdfs");

  if (Array.isArray(pdfs) && pdfs.length > 0) {
    const pid = pdfs[0].paperId;
    const asset = await evalJs(cdp, `return await window.luminaApi.papersAsset(${JSON.stringify(pid)});`);
    asset?.hasPdf ? pass("papers:asset hasPdf", pid.slice(0, 24)) : fail("papers:asset");

    const lib = await evalJs(cdp, `return await window.luminaApi.libraryList();`);
    const inLib = Array.isArray(lib) && lib.some((r) => r.paper?.id === pid || r.paper_id === pid);
    inLib ? pass("library 含已下载 PDF") : skip("library 含 PDF", "autoIngest 可能关闭或尚未 reconcile");

    const bytes = await evalJs(cdp, `
      const raw = await window.luminaOa.readPdf(${JSON.stringify(pid)});
      if (!raw) return 0;
      if (typeof raw.byteLength === "number") return raw.byteLength;
      if (Array.isArray(raw)) return raw.length;
      if (raw.data && Array.isArray(raw.data)) return raw.data.length;
      return Object.keys(raw).length;
    `);
    bytes > 0 ? pass("readPdf 可读", `${bytes} bytes`) : fail("readPdf");
  } else {
    skip("library/read 链", "无已下载 PDF");
  }

  const q = await evalJs(cdp, `return await window.luminaApi.papersFetchQueueStatus();`);
  typeof q?.pending === "number" ? pass("fetchQueueStatus", `pending=${q.pending} active=${q.active}`) : fail("fetchQueueStatus");

  console.log("\n── done ──\n");
} catch (e) {
  fail("runtime", e.message);
} finally {
  cdp.ws.close();
}

process.exit(process.exitCode || 0);
