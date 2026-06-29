#!/usr/bin/env node
/** 删除缓存后重新 fetch + readPdf */
const PID = "doi:10.48550/arxiv.1706.03762";
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index/.test(t.url || ""));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { const { resolve: res, reject: rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const n = id++; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const t0 = Date.now();
const { result } = await send("Runtime.evaluate", {
  expression: `(async()=>{ const r=await window.luminaOa.fetchPaper(${JSON.stringify(PID)}); const b=await window.luminaOa.readPdf(${JSON.stringify(PID)}); return {fetch:r, bytes:b?.byteLength||0}; })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log(result.value, `${Date.now() - t0}ms`);
ws.close();
process.exit(result.value?.fetch?.ok && result.value?.bytes > 1000 ? 0 : 1);
