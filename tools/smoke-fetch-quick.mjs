#!/usr/bin/env node
/** 快速取文探针 · 联络邮箱 + 短超时 */
const EMAIL = process.argv[2] || "wxs_insist@163.com";
const DOI = process.argv[3] || "10.48550/arXiv.1706.03762";
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index/.test(t.url || ""));
if (!page) { console.error("CDP 未就绪"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { const { resolve: res, reject: rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const n = id++; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};

console.log(`\n取文探针 · ${EMAIL} · ${DOI}\n`);
await evalJs(`
  const cur = await window.luminaApi.getSettings()||{};
  await window.luminaApi.saveSettings({...cur, contactEmail:${JSON.stringify(EMAIL)}});
`);
const resolved = await evalJs(`return await window.luminaApi.searchOnline(${JSON.stringify(DOI)}, {});`);
const pid = resolved?.papers?.[0]?.id;
console.log("解析:", resolved?.locateMode, resolved?.papers?.[0]?.title?.slice(0,50), "id=", pid);
if (!pid) { ws.close(); process.exit(1); }

const t0 = Date.now();
const fetchP = evalJs(`return await window.luminaOa.fetchPaper(${JSON.stringify(pid)});`);
const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("fetch 超时 90s")), 90000));
try {
  const r = await Promise.race([fetchP, timeout]);
  console.log(r?.ok ? `✓ fetchPaper ${r.source} · ${Date.now()-t0}ms` : `○ fetch 失败 · ${r?.reason}`);
} catch (e) {
  console.log("✗", e.message);
}
const pdfs = await evalJs(`return await window.luminaOa.listPdfs();`);
console.log("PDF 数:", pdfs?.length);
ws.close();
