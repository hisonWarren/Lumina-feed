#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

async function getWsUrl() {
  const r = await fetch(`${CDP}/json/list`);
  const list = await r.json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("no page target: " + JSON.stringify(list.map((t) => t.url)));
  return page.webSocketDebuggerUrl;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const logs = [];
    ws.addEventListener("open", () => resolve({ ws, send, logs }));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "Runtime.consoleAPICalled") {
        logs.push({ type: msg.params.type, text: msg.params.args?.map((a) => a.value ?? a.description).join(" ") });
      }
      if (msg.method === "Runtime.exceptionThrown") {
        logs.push({ type: "exception", text: msg.params.exceptionDetails?.text || JSON.stringify(msg.params) });
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
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
await new Promise((r) => setTimeout(r, 2000));

const snap = await cdp.send("Page.captureScreenshot", { format: "png" });
const fp = path.join(OUT, "whitescreen-check.png");
writeFileSync(fp, Buffer.from(snap.data, "base64"));

const diag = await cdp.send("Runtime.evaluate", {
  expression: `(() => ({
    title: document.title,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    rootHtml: (document.getElementById('root')?.innerHTML || '').slice(0, 500),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    hasLumina: !!(window.luminaApi),
    err: window.__luminaBootErr || null,
  }))()`,
  returnByValue: true,
});

console.log("Screenshot:", fp);
console.log("Diagnostics:", JSON.stringify(diag.result?.value, null, 2));
console.log("Console/errors:");
for (const l of cdp.logs) console.log(" ", l.type + ":", l.text);

cdp.ws.close();
