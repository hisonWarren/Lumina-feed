#!/usr/bin/env node
/** Reproduce 助手白屏 — CDP console exceptions */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP not ready");
  return page.webSocketDebuggerUrl;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const exceptions = [];
    ws.addEventListener("open", () => resolve({ ws, send, exceptions }));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "Runtime.exceptionThrown") exceptions.push(msg.params);
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

async function evalJs(cdp, expr) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text + (exceptionDetails.exception?.description || ""));
  return result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("── assist whitescreen probe ──");
const cdp = await cdpConnect(await getWsUrl());
await cdp.send("Runtime.enable");

await evalJs(cdp, `
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("阅读"));
  if (b) b.click();
  return true;
`);
await sleep(800);

const opened = await evalJs(cdp, `
  const row = document.querySelector(".rh-row:not(.missing)");
  if (row) { row.click(); return "continue"; }
  return "hub";
`);
console.log("open:", opened);
await sleep(3500);

const before = await evalJs(cdp, `return {
  rd: !!document.querySelector(".rd"),
  topbar: !!document.querySelector(".rd-topbar"),
  lf: !!document.querySelector(".lf-top"),
};`);
console.log("before assist:", before);

await evalJs(cdp, `
  const b = [...document.querySelectorAll(".rd-btn")].find((x) => (x.textContent || "").includes("助手"));
  if (!b) throw new Error("助手 button not found");
  b.click();
  return true;
`);
await sleep(1200);

const after = await evalJs(cdp, `return {
  rd: !!document.querySelector(".rd"),
  topbar: !!document.querySelector(".rd-topbar"),
  lf: !!document.querySelector(".lf-top"),
  assist: !!document.querySelector(".rd-zonepane.assist"),
  ai: !!document.querySelector(".rd-ai"),
  rootLen: document.getElementById("root")?.innerHTML?.length || 0,
};`);
console.log("after assist:", after);

if (cdp.exceptions.length) {
  console.log("exceptions:");
  for (const ex of cdp.exceptions) {
    const d = ex.exceptionDetails || ex;
    console.log(" -", d.text || d.exception?.description || JSON.stringify(d).slice(0, 200));
  }
} else {
  console.log("no Runtime.exceptionThrown captured");
}

try {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const fp = path.join(OUT, "assist-whitescreen.png");
  writeFileSync(fp, Buffer.from(data, "base64"));
  console.log("screenshot:", fp);
} catch (e) {
  console.log("screenshot skip:", e.message);
}

cdp.ws.close();
process.exit(cdp.exceptions.length || !after.rd ? 1 : 0);
