#!/usr/bin/env node
/** P10 预取真机：开启 prefetchOnIdentifier → DOI 检索 → 等待 prefetch:done / 全文就绪 */
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
if (!page) throw new Error("CDP 未就绪");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
let nextId = 1;
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
  const id = nextId++;
  pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};

console.log("\n── P10 预取真机烟测 ──\n");
let prefetchDone = false;
await evalJs(`
  window.__prefetchTest = { done: false, ok: false, source: null };
  window.__prefetchFail = { done: false, reason: null };
  window.luminaOa.onPrefetchDone(({ paperId, result }) => {
    window.__prefetchTest = { done: true, ok: !!(result && result.ok), source: result?.source || null, cached: result?.cached };
  });
  window.luminaOa.onPrefetchFail?.(({ paperId, result }) => {
    window.__prefetchFail = { done: true, reason: result?.reason };
  });
  const cur = await window.luminaApi.getSettings() || {};
  await window.luminaApi.saveSettings({ ...cur, prefetchOnIdentifier: true });
  return true;
`);

const doi = "10.1038/nature12373";
const res = await evalJs(`
  const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("检索取文"));
  if (t) t.click();
  await new Promise(r => setTimeout(r, 400));
  return await window.luminaApi.searchOnline(${JSON.stringify(doi)}, {});
`);
console.log("  标识符解析:", res?.locateMode, res?.papers?.[0]?.title?.slice(0, 50));

for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const st = await evalJs(`return window.__prefetchTest;`);
  if (st?.done) {
    prefetchDone = true;
    console.log(st.ok ? `  ✓ prefetch:done · ${st.source}` : `  ✗ prefetch 失败 · ${JSON.stringify(st)}`);
    break;
  }
  const fail = await evalJs(`return window.__prefetchFail;`);
  if (fail?.done) {
    console.log(`  ○ prefetch:fail · ${fail.reason || "unknown"}`);
    break;
  }
  if (i % 10 === 9) console.log(`  … 等待预取 ${i + 1}s`);
}
if (!prefetchDone) console.log("  ○ 90s 内未收到 prefetch:done（网络/无 OA 可接受）");

const pdfs = await evalJs(`return await window.luminaOa.listPdfs();`);
console.log(`  已下载 PDF: ${pdfs?.length ?? 0} 个`);

await evalJs(`
  const cur = await window.luminaApi.getSettings() || {};
  await window.luminaApi.saveSettings({ ...cur, prefetchOnIdentifier: false });
`);
ws.close();
console.log("\n完成\n");
