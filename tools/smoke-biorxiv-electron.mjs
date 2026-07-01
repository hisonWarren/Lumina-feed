#!/usr/bin/env node
/** 真机烟测：bioRxiv 预印本经 Electron session 取 PDF（自启 CDP 9222） */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const DOI = "10.1101/2025.10.09.681210";

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitCdp(maxMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error("CDP 9222 未就绪");
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("open", () => resolve({ send }));
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

const electronExe = path.join(ROOT, "node_modules/electron/dist/electron.exe");
const child = spawn(electronExe, [".", "--remote-debugging-port=9222", "--disable-gpu"], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
});

let exitCode = 1;
try {
  console.log("\n── smoke-biorxiv-electron ──\n");
  const ws = await waitCdp();
  const cdp = await cdpConnect(ws);
  await cdp.send("Runtime.enable");
  console.log("  ✓ Electron CDP 就绪");

  for (let i = 0; i < 60; i++) {
    try {
      const ready = await evalJs(cdp, `return !!(window.luminaApi && window.luminaOa)`);
      if (ready) break;
    } catch { /* reload */ }
    await sleep(500);
  }

  let out;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      out = await evalJs(cdp, `
        const doi = ${JSON.stringify(DOI)};
        const resolved = await window.luminaApi.searchOnline(doi, {});
        const pid = resolved?.papers?.[0]?.id || ("doi:" + doi);
        const r = await window.luminaOa.fetchPaper(pid);
        const b = r?.ok ? await window.luminaOa.readPdf(pid) : null;
        return { pid, ok: r?.ok, source: r?.source, bytes: b?.byteLength || 0, reason: r?.reason };
      `);
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(2000);
    }
  }
  console.log("  结果:", JSON.stringify(out));
  if (out?.ok && out.bytes > 10_000) {
    console.log(`  ✓ bioRxiv fetch ${out.source} · ${out.bytes} bytes`);
    exitCode = 0;
  } else {
    console.log("  ✗ bioRxiv fetch 失败");
  }
} catch (e) {
  console.log("  ✗", e.message);
} finally {
  try { child.kill(); } catch { /* ignore */ }
  console.log("\n── done ──\n");
  process.exit(exitCode);
}
