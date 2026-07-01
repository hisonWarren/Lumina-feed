#!/usr/bin/env node
/** v0.4.79 回归：bioRxiv 取文 · PDF 删除清继续阅读 · 长问题定位问答 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askReader } from "../src/core/reader/reader-ai.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const DOI = "10.1101/2025.10.09.681210";

const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); process.exitCode = 1; };

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

async function evalJs(cdp, expr, retries = 3) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
        expression: `(async()=>{ ${expr} })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
      return result.value;
    } catch (e) {
      last = e;
      await sleep(1500);
    }
  }
  throw last;
}

// ── 1. 长问题定位（纯逻辑，不依赖 LLM）──
console.log("\n── smoke-v0479-regression ──\n");
const pages = [
  { page: 2, text: "Point-light displays reveal biological motion." },
  { page: 4, text: "Stimuli were shown for 200ms on each trial." },
];
const longQ = "静止时是一团散点，一旦运动立即被看成「人」；约 200 ms 内即可读出动作。。200ms具体是在哪提到";
const locate = await askReader(pages, longQ, { chat: async () => ({ text: "fallback" }) });
if (!locate.text || !/\[p\.4\]/.test(locate.text)) fail("long locate question", locate.text?.slice(0, 80));
else pass("long locate question", `[p.4] grounded=${locate.groundedRatio}`);

const electronExe = path.join(ROOT, "node_modules/electron/dist/electron.exe");
const child = spawn(electronExe, [".", "--remote-debugging-port=9222", "--disable-gpu"], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
});

let cdp;
try {
  const ws = await waitCdp();
  cdp = await cdpConnect(ws);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 60; i++) {
    const ready = await evalJs(cdp, `return !!(window.luminaApi && window.luminaOa)`);
    if (ready) break;
    await sleep(500);
  }
  pass("Electron CDP 就绪");

  // ── 2. bioRxiv 取文 ──
  let fetchOut;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fetchOut = await evalJs(cdp, `
        const doi = ${JSON.stringify(DOI)};
        const resolved = await window.luminaApi.searchOnline(doi, {});
        const pid = resolved?.papers?.[0]?.id || ("doi:" + doi);
        const r = await window.luminaOa.fetchPaper(pid);
        const b = r?.ok ? await window.luminaOa.readPdf(pid) : null;
        return { pid, ok: r?.ok, source: r?.source, bytes: b?.byteLength || 0 };
      `);
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(2000);
    }
  }
  if (fetchOut?.ok && fetchOut.bytes > 10_000) pass("bioRxiv fetch", `${fetchOut.source} · ${fetchOut.bytes} bytes`);
  else fail("bioRxiv fetch", JSON.stringify(fetchOut));

  const pid = fetchOut.pid;

  // ── 3. 写入继续阅读后删除 PDF，历史应清除 ──
  await evalJs(cdp, `
    await window.luminaReader.recordOpen({ paperId: ${JSON.stringify(pid)}, title: "smoke-test", page: 1 });
    return true;
  `);
  const before = await evalJs(cdp, `return (await window.luminaReader.continueList()).map(x => x.entryKey)`);
  if (!before.includes(`paper:${pid}`)) fail("continue entry seeded", JSON.stringify(before));
  else pass("continue entry seeded");

  const deleted = await evalJs(cdp, `return await window.luminaApi.pdfDelete(${JSON.stringify(pid)}, { removeFromLibrary: false })`);
  if (!deleted) fail("pdfDelete");
  else pass("pdfDelete");

  await sleep(300);
  const after = await evalJs(cdp, `return (await window.luminaReader.continueList()).map(x => x.entryKey)`);
  if (after.includes(`paper:${pid}`)) fail("continue cleared after delete", JSON.stringify(after));
  else pass("continue cleared after delete");
} catch (e) {
  fail("runtime", e.message);
} finally {
  try { cdp?.close(); } catch { /* ignore */ }
  try { child.kill(); } catch { /* ignore */ }
  console.log("\n── done ──\n");
  process.exit(process.exitCode || 0);
}
