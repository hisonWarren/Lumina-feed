#!/usr/bin/env node
/** Capture README screenshots via CDP. Output: docs/screenshots/*.png */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const PORT = 9250;
const CDP = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitCdp(ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(400);
  }
  throw new Error("CDP timeout");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const pending = new Map();
    ws.addEventListener("open", () => resolve({ ws, send }));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m.result);
        pending.delete(m.id);
      }
    });
    function send(method, params = {}) {
      return new Promise((r) => {
        pending.set(id, r);
        ws.send(JSON.stringify({ id: id++, method, params }));
      });
    }
  });
}

async function evalJs(cdp, expr) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: `(()=>{${expr}})()`,
    returnByValue: true,
  });
  if (exceptionDetails?.text) {
    const extra = exceptionDetails.exception?.description || exceptionDetails.text;
    throw new Error(extra);
  }
  return result.value;
}

async function shot(cdp, name) {
  await cdp.send("Page.enable");
  try {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (!data) throw new Error("empty screenshot data");
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log("  ✓", name);
  } catch (e) {
    console.error("  ✗", name, e.message);
    throw e;
  }
}

function clickTab(cdp, label) {
  const lit = JSON.stringify(label);
  return evalJs(cdp, `const btn=[...document.querySelectorAll(".lf-nav .lf-tab")].find(b=>(b.textContent||'').includes(${lit}));if(!btn)return false;btn.click();return true;`);
}

function searchJournal(cdp, q) {
  const lit = JSON.stringify(q);
  return evalJs(cdp, `const i=document.querySelector(".jr-bar input");if(!i)return false;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;s.call(i,${lit});i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return true;`);
}

const child = spawn(
  path.join(ROOT, "node_modules/electron/dist/electron.exe"),
  [".", `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, stdio: "ignore", windowsHide: true },
);

try {
  const ws = await waitCdp();
  const cdp = await connect(ws);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 80; i++) {
    if (await evalJs(cdp, "return !!document.querySelector('.lf-nav');")) break;
    await sleep(400);
  }

  console.log("\n── capture-readme-screenshots ──\n");

  // 1) 检索取文
  await clickTab(cdp, "检索取文");
  await sleep(800);
  await shot(cdp, "01-find-fetch.png");

  // 2) 期刊 · Nature
  await clickTab(cdp, "期刊");
  await sleep(600);
  await searchJournal(cdp, "Nature");
  await sleep(7000);
  await shot(cdp, "02-journals.png");

  // 3) 我的文献
  await clickTab(cdp, "我的文献");
  await sleep(800);
  await shot(cdp, "03-library.png");

  // 4) 阅读
  await clickTab(cdp, "阅读");
  await sleep(800);
  await shot(cdp, "04-reader.png");

  // 5) 订阅简报
  await clickTab(cdp, "订阅简报");
  await sleep(800);
  await shot(cdp, "05-subscriptions.png");

  cdp.ws.close();
  console.log("\n  → docs/screenshots/\n");
} catch (e) {
  console.error("ERR", e?.message || e);
  if (e?.stack) console.error(e.stack);
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
}
