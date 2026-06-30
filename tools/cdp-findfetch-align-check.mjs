#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

async function getWsUrl() {
  const r = await fetch(`${CDP}/json/list`);
  const page = (await r.json()).find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP not ready");
  return page.webSocketDebuggerUrl;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("open", () => resolve({ ws, send }));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    function send(method, params = {}) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
  });
}

const cdp = await cdpConnect(await getWsUrl());
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

await cdp.send("Runtime.evaluate", {
  expression: `(async()=>{
    const tab = [...document.querySelectorAll('.lf-tab')].find(b=>(b.textContent||'').includes('检索'));
    if (tab) tab.click();
    await new Promise(r=>setTimeout(r,600));
    return true;
  })()`,
  awaitPromise: true,
});

const metrics = await cdp.send("Runtime.evaluate", {
  expression: `(() => {
    const bar = document.querySelector('.ff-bar');
    const tools = document.querySelector('.ff-tools');
    const session = document.querySelector('.ff-session-bar');
    const banner = document.querySelector('.ff-primary-banner');
    const card = document.querySelector('.ff-card');
    const rect = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
    const left = (el) => el ? Math.round(el.getBoundingClientRect().left) : null;
    return {
      bar: { w: rect(bar), l: left(bar) },
      tools: { w: rect(tools), l: left(tools) },
      session: { w: rect(session), l: left(session) },
      banner: { w: rect(banner), l: left(banner) },
      card: { w: rect(card), l: left(card) },
      rootChildren: document.getElementById('root')?.childElementCount ?? 0,
    };
  })()`,
  returnByValue: true,
});

const snap = await cdp.send("Page.captureScreenshot", { format: "png" });
const fp = path.join(OUT, "findfetch-align-check.png");
writeFileSync(fp, Buffer.from(snap.data, "base64"));

const m = metrics.result?.value || {};
console.log("Screenshot:", fp);
console.log("Widths:", JSON.stringify(m, null, 2));

const tol = 2;
const refW = m.session?.w || m.bar?.w;
const refL = m.session?.l ?? m.bar?.l;
let ok = m.rootChildren > 0;
for (const [k, v] of Object.entries(m)) {
  if (!v || typeof v !== "object" || v.w == null) continue;
  if (Math.abs(v.w - refW) > tol) { ok = false; console.log("WIDTH MISMATCH", k, v.w, "vs", refW); }
  if (Math.abs(v.l - refL) > tol) { ok = false; console.log("LEFT MISMATCH", k, v.l, "vs", refL); }
}
console.log(ok ? "ALIGN OK" : "ALIGN FAIL");
cdp.ws.close();
process.exit(ok ? 0 : 1);
