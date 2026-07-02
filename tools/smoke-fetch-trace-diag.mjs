#!/usr/bin/env node
/** 取文 trace 诊断：记录各步骤状态与耗时 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

try {
  console.log("\n── smoke-fetch-trace-diag ──\n");
  const cdp = await cdpConnect(await waitCdp());
  for (let i = 0; i < 60; i++) {
    if (await evalJs(cdp, `return !!(window.luminaOa && window.luminaOa.fetchPaperStream)`)) break;
    await sleep(500);
  }

  const pid = `doi:${DOI}`;
  await evalJs(cdp, `try { await window.luminaApi.pdfDelete(${JSON.stringify(pid)}, { removeFromLibrary: false }); } catch {} return true;`);
  await sleep(300);

  const out = await evalJs(cdp, `
    const pid = ${JSON.stringify(pid)};
    const reqId = Date.now();
    const snapshots = [];
    const t0 = Date.now();
    const stop = window.luminaOa.fetchPaperStream(pid, reqId, (p) => {
      if (p && (p.type === 'step' || p.type === 'done')) snapshots.push({ type: p.type, steps: p.steps, result: p.result });
    }, { channel: "manual" });
    await new Promise((r) => setTimeout(r, 125000));
    stop && stop();
    const last = snapshots.filter(s => s.type === 'done').pop();
    const final = last?.result || { ok: false, reason: 'timeout' };
    return { ok: final.ok, source: final.source, reason: final.reason, ms: Date.now()-t0, snapshots: snapshots.length, lastSteps: snapshots.length ? snapshots[snapshots.length-1].steps : [] };
  `);
  const steps = {};
  for (const s of out.lastSteps || []) {
    steps[s.id] = { status: s.status, detail: s.detail, ms: s.ms };
  }
  const line = JSON.stringify({
    sessionId: "07b43d", runId: "trace-diag", hypothesisId: "H1",
    location: "smoke-fetch-trace-diag", message: "fetch trace",
    data: { ok: out.ok, source: out.source, reason: out.reason, fetchMs: out.ms, steps },
    timestamp: Date.now(),
  });
  fs.appendFileSync(LOG, line + "\n");
  console.log("  ok:", out.ok, "source:", out.source, "reason:", out.reason, "ms:", out.ms);
  for (const [k, v] of Object.entries(steps)) {
    console.log(`  ${k}: ${v.status} ${v.detail || ""} (${v.ms || "?"}ms)`);
  }
  console.log(out.ok ? "\n  ✓ fetch OK" : "\n  ✗ fetch FAIL");
  process.exitCode = out.ok ? 0 : 1;
} catch (e) {
  console.log("  ✗", e.message);
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  console.log("\n── done ──\n");
  process.exit(process.exitCode || 1);
}
