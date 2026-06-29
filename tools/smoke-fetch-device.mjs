#!/usr/bin/env node
/** 真机取文 · 等待页面就绪 + 超时保护 */
const CDP = "http://127.0.0.1:9222";
const PID = process.argv[2] || "doi:10.48550/arxiv.1706.03762";

async function waitPage(maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const list = await (await fetch(`${CDP}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
    if (page) return page.webSocketDebuggerUrl;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("index.html 未就绪");
}

function cdpEval(wsUrl, expr, timeoutMs = 130000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const timer = setTimeout(() => { ws.close(); reject(new Error(`CDP 超时 ${timeoutMs}ms`)); }, timeoutMs);
    ws.addEventListener("open", async () => {
      try {
        ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
        await new Promise((r) => setTimeout(r, 100));
        const reqId = id++;
        ws.send(JSON.stringify({
          id: reqId,
          method: "Runtime.evaluate",
          params: { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true },
        }));
      } catch (e) { clearTimeout(timer); reject(e); }
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === 1) return;
      if (msg.id && msg.id > 1) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else if (msg.result?.exceptionDetails?.text) reject(new Error(msg.result.exceptionDetails.text));
        else resolve(msg.result?.value);
      }
    });
    ws.addEventListener("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

console.log(`\n真机取文 · ${PID}\n`);
const wsUrl = await waitPage();
console.log("CDP 页面就绪");

const t0 = Date.now();
const out = await cdpEval(wsUrl, `
  const q = ${JSON.stringify(PID.replace(/^doi:/, ""))};
  const resolved = await window.luminaApi.searchOnline(q, {});
  const pid = resolved?.papers?.[0]?.id || ${JSON.stringify(PID)};
  const r = await window.luminaOa.fetchPaper(pid);
  const b = await window.luminaOa.readPdf(pid);
  return { pid, paper: resolved?.papers?.[0], fetch: r, bytes: b?.byteLength || 0 };
`);
console.log(`${Date.now() - t0}ms`, JSON.stringify(out));
process.exit(out?.fetch?.ok && out.bytes > 1000 ? 0 : 1);
