#!/usr/bin/env node
/** 验证 readPdf 对含 / 的 paperId 是否失败 */
const CDP = "http://127.0.0.1:9222";
const PID = "doi:10.48550/arxiv.1706.03762";

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index/.test(t.url || ""));
if (!page) { console.error("CDP 未就绪"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) {
    const { resolve: res, reject: rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = id++;
  pending.set(n, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send("Runtime.enable");

const userData = await send("Runtime.evaluate", {
  expression: "window.luminaApi.getUserDataPath()",
  awaitPromise: true,
  returnByValue: true,
});
console.log("userData:", userData.result.value);

const fetchR = await send("Runtime.evaluate", {
  expression: `(async()=>window.luminaOa.fetchPaper(${JSON.stringify(PID)}))()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log("fetchPaper:", fetchR.result.value);

const readR = await send("Runtime.evaluate", {
  expression: `(async()=>{ try { const b=await window.luminaOa.readPdf(${JSON.stringify(PID)}); return b?{bytes:b.byteLength}:null; } catch(e){ return {error:String(e)}; } })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log("readPdf:", readR.result.value);

const listR = await send("Runtime.evaluate", {
  expression: "window.luminaOa.listPdfs()",
  awaitPromise: true,
  returnByValue: true,
});
console.log("listPdfs count:", listR.result.value?.length);
console.log("sample ids:", (listR.result.value || []).slice(0, 3).map((x) => x.paperId));

ws.close();
