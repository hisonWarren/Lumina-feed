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
await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("阅读")).click();`);
await new Promise((r) => setTimeout(r, 1000));
const txt = await evalJs(`return document.querySelector(".rhx")?.innerText?.slice(0,600)||"no rhx";`);
console.log("\nhub text:\n", txt);
const rows = await evalJs(`return document.querySelectorAll(".rh-row").length;`);
console.log("rows:", rows);
if (rows) {
  await evalJs(`document.querySelector(".rh-row").click();`);
  await new Promise((r) => setTimeout(r, 10000));
  console.log("tabs:", await evalJs(`return document.querySelectorAll(".rhx-tab").length;`));
  console.log("rd:", await evalJs(`return !!document.querySelector(".rd-wrap,.rd");`));
}
ws.close();
