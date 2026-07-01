#!/usr/bin/env node
/** 烟测：冷启动 argv 打开 PDF 应直达阅读器（preload 缓冲 + 切 read 模式）· CDP 9222 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const PDF = process.env.LUMINA_TEST_PDF || "D:\\毕业论文\\文献PDF\\20_Papeo_2017.pdf";

const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); process.exitCode = 1; };

if (!fs.existsSync(PDF)) {
  console.error(`PDF 不存在: ${PDF}`);
  process.exit(2);
}

const preload = fs.readFileSync(path.join(ROOT, "build/preload.cjs"), "utf8");
preload.includes("pendingOpenLocalPdf") && preload.includes("openLocalPdfHandler")
  ? pass("CO-0", "preload 含首次打开缓冲")
  : fail("CO-0", "preload 缺缓冲逻辑");

async function waitCdp(ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("CDP 超时");
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

console.log("\n── smoke-pdf-cold-open ──\n");

let child;
try {
  child = spawn(path.join(ROOT, "node_modules/electron/dist/electron.exe"), [".", PDF, "--remote-debugging-port=9222"], {
    cwd: ROOT,
    stdio: "ignore",
    windowsHide: true,
  });
} catch (e) {
  fail("启动", e.message);
  process.exit(2);
}

let cdp;
try {
  const wsUrl = await waitCdp();
  cdp = await cdpConnect(wsUrl);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 40; i++) {
    const st = await evalJs(cdp, `
      const readOn = [...document.querySelectorAll(".lf-tab")].some(b => (b.textContent||"").includes("阅读") && b.classList.contains("on"));
      const hasReader = !!document.querySelector(".rd");
      const hasFind = !!document.querySelector(".ff") || (document.querySelector(".lf-tab.on")?.textContent||"").includes("检索");
      return { readOn, hasReader, hasFind };
    `);
    if (st?.readOn && st?.hasReader) break;
    await new Promise((r) => setTimeout(r, 500));
    if (i === 39) fail("CO-1", `未直达阅读器 readOn=${st?.readOn} reader=${st?.hasReader} find=${st?.hasFind}`);
  }
  if (!process.exitCode) pass("CO-1", "冷启动 argv PDF 直达阅读器");

  for (let i = 0; i < 30; i++) {
    const hasText = await evalJs(cdp, `return !!document.querySelector(".textLayer span");`);
    if (hasText) { pass("CO-2", "文本层已渲染"); break; }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 29) fail("CO-2", "无文本层");
  }

  cdp.ws.close();
} catch (e) {
  fail("烟测", e.message);
} finally {
  try { child?.kill(); } catch { /* ignore */ }
}

console.log("\n── done ──\n");
process.exit(process.exitCode || 0);
