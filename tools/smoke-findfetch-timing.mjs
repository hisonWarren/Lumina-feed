#!/usr/bin/env node
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject: rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = id++;
  pending.set(n, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};
await send("Runtime.enable");
await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("检索")).click();`);
await new Promise((r) => setTimeout(r, 500));
const t0 = Date.now();
const n = await evalJs(`const r=await window.luminaApi.searchOnline("covid vaccine",{}); return (r.papers||[]).length;`);
console.log(`IPC search: ${n} papers in ${Date.now() - t0}ms`);
await evalJs(`
  const inp=document.querySelector(".ff-bar input");
  inp.value="covid vaccine";
  inp.dispatchEvent(new Event("input",{bubbles:true}));
  inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
`);
for (let i = 0; i < 35; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const cards = await evalJs(`return document.querySelectorAll(".ff-card").length;`);
  const loading = await evalJs(`return !!document.querySelector(".ff-spin");`);
  if (cards > 0) { console.log(`UI cards at ${i + 1}s: ${cards}`); break; }
  if (i === 34) console.log(`no cards after 35s, loading=${loading}`);
}
ws.close();
