#!/usr/bin/env node
/** 多标签开读：诊断 + 重试 */
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index/.test(t.url || ""));
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

console.log("\n── multidoc 开读诊断 ──\n");

const dl = await evalJs(`
  const list = await window.luminaOa.listPdfs();
  return { pdfs: list };
`);

const read = await evalJs(`
  const id = (await window.luminaOa.listPdfs())[0]?.paperId;
  if (!id) return { err: "no pdf" };
  const bytes = await window.luminaOa.readPdf(id);
  return { id, len: bytes?.byteLength || 0 };
`);
console.log("  readPdf:", read);

await evalJs(`document.querySelector('[role=tab][aria-selected]')?.click?.();`);
await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("阅读"))?.click();`);
await new Promise((r) => setTimeout(r, 600));
await evalJs(`document.querySelector(".rhx-home")?.click();`);
await new Promise((r) => setTimeout(r, 1000));

const hub = await evalJs(`
  return {
    rows: [...document.querySelectorAll(".rh-row")].map(r => r.querySelector(".nm")?.textContent),
    loading: document.body.innerText.includes("读取已下载列表"),
    empty: document.body.innerText.includes("本机暂无已下载"),
  };
`);
console.log("  hub:", hub);

if (hub.rows?.length) {
  await evalJs(`document.querySelector(".rh-row").click();`);
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const tabs = await evalJs(`return document.querySelectorAll(".rhx-tab").length;`);
    const reader = await evalJs(`return !!document.querySelector(".rd, .reader, [class*=rd-]");`);
    console.log(`  wait ${i + 1}s: tabs=${tabs} reader=${reader}`);
    if (tabs > 0) break;
  }
}

ws.close();
