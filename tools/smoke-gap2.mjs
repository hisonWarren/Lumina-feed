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

console.log("\n── gap2：multidoc rh-row · FindFetch 新 chip ──\n");

await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("阅读")).click();`);
await new Promise((r) => setTimeout(r, 500));
await evalJs(`const h=document.querySelector(".rhx-home"); if(h) h.click();`);
await new Promise((r) => setTimeout(r, 800));
const rows = await evalJs(`return document.querySelectorAll(".rh-row").length;`);
console.log(`  rh-row: ${rows}`);
if (rows > 0) {
  await evalJs(`document.querySelector(".rh-row").click();`);
  await new Promise((r) => setTimeout(r, 3500));
  const tabs = await evalJs(`return document.querySelectorAll(".rhx-tab").length;`);
  console.log(tabs > 1 ? `  ✓ multidoc 标签 ${tabs}` : `  ✗ multidoc tabs=${tabs}`);
}

await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("检索")).click();`);
await new Promise((r) => setTimeout(r, 400));
await evalJs(`[...document.querySelectorAll(".ff-chip")].find(b=>(b.textContent||"").includes("主题词"))?.click();`);
await new Promise((r) => setTimeout(r, 14000));
const cards = await evalJs(`return document.querySelectorAll(".ff-card").length;`);
const sort = await evalJs(`return !!document.querySelector(".ff-sort select");`);
const cite = await evalJs(`return document.querySelectorAll("button.ff-act").length;`);
console.log(cards > 0 ? `  ✓ ff-card ${cards}` : `  ✗ ff-card 0`);
console.log(sort ? `  ✓ 排序 select` : `  ✗ 排序 select`);
console.log(cite > 0 ? `  ✓ 引用按钮 ${cite}` : `  ✗ 引用按钮`);
ws.close();
