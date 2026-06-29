#!/usr/bin/env node
/** 取文诊断：解析字段 + fetchPaper + 直链 fetchPdf */
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const DOI = process.argv[2] || "10.48550/arXiv.1706.03762";
const EMAIL = process.argv[3] || "wxs_insist@163.com";

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP 9222 未就绪");
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

console.log(`\n取文诊断 · ${DOI}\n`);
const cdp = await cdpConnect(await getWsUrl());
await cdp.send("Runtime.enable");

await evalJs(cdp, `
  const cur = await window.luminaApi.getSettings()||{};
  await window.luminaApi.saveSettings({...cur, contactEmail:${JSON.stringify(EMAIL)}});
`);

const resolved = await evalJs(cdp, `return await window.luminaApi.searchOnline(${JSON.stringify(DOI)}, {});`);
const p = resolved?.papers?.[0];
console.log("locateMode:", resolved?.locateMode);
console.log("paper:", JSON.stringify({
  id: p?.id,
  doi: p?.doi,
  arxivId: p?.arxivId,
  oaUrl: p?.oaUrl,
  oaStatus: p?.oaStatus,
  pmcid: p?.pmcid,
  title: (p?.title || "").slice(0, 60),
}, null, 2));

if (!p?.id) { cdp.ws.close(); process.exit(1); }

// 直链 fetchPdf（绕过候选链）
const directUrl = "https://arxiv.org/pdf/1706.03762.pdf";
const tDirect = Date.now();
const direct = await evalJs(cdp, `return await window.luminaOa.fetchPdf(${JSON.stringify(directUrl)});`);
console.log(`\n直链 fetchPdf: ${direct?.ok ? "OK" : "FAIL"} · ${Date.now() - tDirect}ms · bytes=${direct?.bytes?.length || direct?.reason}`);

// fetchPaper（完整链）
const t0 = Date.now();
const events = [];
const fr = await evalJs(cdp, `
  return await new Promise((resolve) => {
    const reqId = Date.now();
    const events = [];
    const stop = window.luminaOa.fetchPaperStream(${JSON.stringify(p.id)}, reqId, (ev) => {
      events.push({ type: ev?.type, result: ev?.result, lastStep: ev?.steps?.slice(-2) });
      if (ev?.type === 'done' || ev?.type === 'final') { stop?.(); resolve({ events, result: ev?.result || ev?.result }); }
    });
    setTimeout(() => { stop?.(); resolve({ events, result: { ok: false, reason: 'timeout_90s' } }); }, 90000);
  });
`);
console.log(`\nfetchPaperStream: ${Date.now() - t0}ms`);
console.log("result:", fr?.result);
for (const e of fr?.events || []) console.log(" ", e.type, e.result?.ok ?? e.result?.reason ?? "", e.lastStep?.map(s => s.id+':'+s.status).join(' '));

const bytes = await evalJs(cdp, `
  try { const b = await window.luminaOa.readPdf(${JSON.stringify(p.id)}); return b?.byteLength||0; } catch { return 0; }
`);
console.log("\nreadPdf bytes:", bytes);
cdp.ws.close();
process.exit(fr?.result?.ok && bytes > 1000 ? 0 : 1);
