#!/usr/bin/env node
/** 探测取文期间 IPC 延迟与 bioRxiv 版本尝试次数 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const DOI = "10.1101/2025.10.09.681210";
const LOG = path.resolve(ROOT, "..", "debug-07b43d.log");

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
  throw new Error("CDP 未就绪");
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("open", () => resolve({ send, close: () => ws.close() }));
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
  cwd: ROOT, stdio: "ignore", windowsHide: true,
});

const samples = [];
let exitCode = 1;

try {
  console.log("\n── smoke-freeze-probe ──\n");
  const cdp = await cdpConnect(await waitCdp());
  for (let i = 0; i < 60; i++) {
    if (await evalJs(cdp, `return !!(window.luminaApi && window.luminaOa)`)) break;
    await sleep(500);
  }

  const pid = `doi:${DOI}`;
  // 删除已有 PDF 强制重抓
  await evalJs(cdp, `try { await window.luminaApi.pdfDelete(${JSON.stringify(pid)}, { removeFromLibrary: false }); } catch {} return true;`);
  await sleep(200);

  const probe = async () => {
    const t0 = Date.now();
    await evalJs(cdp, `const t=Date.now(); await window.luminaApi.libraryList(); return Date.now()-t;`);
    return Date.now() - t0;
  };

  const poll = setInterval(() => { void probe().then((ms) => samples.push(ms)).catch(() => {}); }, 400);
  const tFetch0 = Date.now();
  const out = await evalJs(cdp, `
    const pid = ${JSON.stringify(pid)};
    const r = await window.luminaOa.fetchPaper(pid);
    return { ok: r?.ok, source: r?.source, ms: Date.now() };
  `);
  const fetchMs = Date.now() - tFetch0;
  clearInterval(poll);
  await sleep(300);
  const afterProbe = await probe();

  const maxIpc = samples.length ? Math.max(...samples) : 0;
  const avgIpc = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  const line = JSON.stringify({
    sessionId: "07b43d", runId: "freeze-probe", hypothesisId: "H1",
    location: "smoke-freeze-probe", message: "fetch ipc latency",
    data: { fetchMs, maxIpc: Math.round(maxIpc), avgIpc: Math.round(avgIpc), samples: samples.length, source: out?.source, afterProbe: Math.round(afterProbe) },
    timestamp: Date.now(),
  });
  fs.appendFileSync(LOG, line + "\n");
  console.log("  fetchMs:", fetchMs, "maxIpc:", Math.round(maxIpc), "avgIpc:", Math.round(avgIpc), "source:", out?.source);
  if (out?.ok && maxIpc < 3000) {
    console.log("  ✓ fetch ok, IPC stayed responsive");
    exitCode = 0;
  } else if (out?.ok) {
    console.log("  ⚠ fetch ok but IPC lagged", Math.round(maxIpc), "ms");
    exitCode = 0;
  } else {
    console.log("  ✗ fetch failed", JSON.stringify(out));
  }
} catch (e) {
  console.log("  ✗", e.message);
} finally {
  try { child.kill(); } catch { /* ignore */ }
  console.log("\n── done ──\n");
  process.exit(exitCode);
}
