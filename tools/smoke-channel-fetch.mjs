#!/usr/bin/env node
/** 分通道取文烟测：每通道用已知可下 DOI 验证（非空跑全链） */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";

/** expectSource：命中 source 应匹配的正则 */
const CASES = [
  { id: "biorxiv_new_prefix", doi: "10.64898/2026.01.05.697634", expectSource: /biorxiv/i, label: "openRxiv 新前缀 bioRxiv API" },
  { id: "biorxiv_legacy", doi: "10.1101/2025.10.09.681210", expectSource: /biorxiv/i, label: "bioRxiv 旧前缀" },
  { id: "plos_oa", doi: "10.1371/journal.pone.0264969", expectSource: /plos|crossref|publisher|openalex|paper_oa/i, label: "PLOS ONE OA" },
];

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitCdp(maxMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && (t.url || "").trim() && !/^about:blank$/i.test(t.url || ""));
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

let failed = 0;

try {
  console.log("\n── smoke-channel-fetch ──\n");
  const cdp = await cdpConnect(await waitCdp());
  for (let i = 0; i < 60; i++) {
    if (await evalJs(cdp, `return !!(window.luminaApi && window.luminaOa)`)) break;
    await sleep(500);
  }

  for (const c of CASES) {
    const pid = `doi:${c.doi}`;
    await evalJs(cdp, `try { await window.luminaApi.pdfDelete(${JSON.stringify(pid)}, { removeFromLibrary: false }); } catch {} return true;`);
    await sleep(200);
    const t0 = Date.now();
    const timeoutMs = c.timeoutMs ?? 90_000;
    const out = await evalJs(cdp, `
      const doi = ${JSON.stringify(c.doi)};
      const resolved = await window.luminaApi.searchOnline(doi, {});
      const pid = resolved?.papers?.[0]?.id || ("doi:" + doi);
      const r = await Promise.race([
        window.luminaOa.fetchPaper(pid),
        new Promise((_, rej) => setTimeout(() => rej(new Error("fetch timeout")), ${timeoutMs})),
      ]);
      const b = r?.ok ? await window.luminaOa.readPdf(pid) : null;
      return { pid, ok: r?.ok, source: r?.source, bytes: b?.byteLength || 0, reason: r?.reason };
    `);
    const ms = Date.now() - t0;
    const fetched = out?.ok && out.bytes > 10_000;
    const channelMatch = !c.expectSource || c.expectSource.test(String(out?.source || ""));
    const ok = fetched && channelMatch;
    if (ok) console.log(`  ✓ ${c.id} — ${c.label} · ${out.source} · ${out.bytes} bytes · ${ms}ms`);
    else {
      failed++;
      console.log(`  ✗ ${c.id} — ${c.label} · ${JSON.stringify(out)} · ${ms}ms`);
    }
    await sleep(800);
  }

  console.log(failed ? `\n  ${failed}/${CASES.length} 失败` : `\n  全部 ${CASES.length} 通道通过`);
} catch (e) {
  console.log("  ✗", e.message);
  failed++;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  console.log("\n── done ──\n");
  process.exit(failed ? 1 : 0);
}
