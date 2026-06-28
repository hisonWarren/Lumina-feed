#!/usr/bin/env node
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

await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("阅读"))?.click();`);
await new Promise((r) => setTimeout(r, 1000));

const ARXIV = "smoke-graph-1706";
await evalJs(`
  const list = await window.luminaOa.listPdfs();
  if (!list.find(x => x.paperId === ${JSON.stringify(ARXIV)})) {
    await window.luminaOa.fetchPdf("https://arxiv.org/pdf/1706.03762.pdf", ${JSON.stringify(ARXIV)});
  }
  return await window.luminaOa.listPdfs();
`).then((l) => console.log("pdfs:", l));

await evalJs(`document.querySelector(".rhx-home")?.click();`).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

const before = await evalJs(`return { rows: document.querySelectorAll(".rh-row").length, rail: !!document.querySelector(".rh-rail") };`);
console.log("before click:", before);

if (before.rows > 0) {
  await evalJs(`document.querySelector(".rh-row").click();`);
  await new Promise((r) => setTimeout(r, 8000));
}

const after = await evalJs(`
  return {
    rd: !!document.querySelector(".rd"),
    vtoggle: !!document.querySelector(".rd-vtoggle"),
    flowBtn: [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("逻辑流程图")),
    tabs: document.querySelectorAll(".rhx-tab").length,
  };
`);
console.log("after:", after);
ws.close();
