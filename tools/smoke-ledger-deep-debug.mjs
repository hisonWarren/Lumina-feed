#!/usr/bin/env node
/** 深读 claim 账本：注入畸形缓存 + UI 点击，捕获 ErrorBoundary / debug 日志 */
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

console.log("── ledger deep debug smoke ──");
const cdp = await cdpConnect(await getWsUrl());
await cdp.send("Runtime.enable");

// 注入畸形 ledger 缓存（模拟旧版：346 条 + 空 graph 对象）
const bigClaims = Array.from({ length: 346 }, (_, i) => ({
  text: `论断：测试 ${i}；证据：页内数据`,
  evidenceType: "internal_data",
  pageRefs: [(i % 5) + 1],
}));
await evalJs(cdp, `
  const key = "paper:smoke-ledger-debug";
  const env = {
    lane: "evidence",
    model: "test",
    title: "claim–证据账本",
    graph: {},
    claims: ${JSON.stringify(bigClaims)},
  };
  await window.luminaReader.analysisSave(key, { ...env, kind: "ledger" });
  return key;
`);
console.log("injected corrupt ledger cache (346 claims + graph:{})");

await evalJs(cdp, `
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("阅读"));
  if (b) b.click();
  return true;
`);
await sleep(800);

// 打开任意 PDF 行（若无则跳过 UI）
const opened = await evalJs(cdp, `
  const row = document.querySelector(".rh-row:not(.missing)");
  if (row) { row.click(); return "pdf"; }
  return "no-pdf";
`).catch(() => "no-pdf");
console.log("reader open:", opened);
if (opened === "pdf") {
  await sleep(3500);
  await evalJs(cdp, `
    const b = [...document.querySelectorAll(".rd-btn")].find((x) => (x.textContent || "").includes("助手"));
    if (b) b.click();
    return true;
  `);
  await sleep(600);
  await evalJs(cdp, `
    const b = [...document.querySelectorAll(".rd-zone")].find((x) => (x.textContent || "").includes("深读"));
    if (b) b.click();
    return true;
  `);
  await sleep(800);
  await evalJs(cdp, `
    const b = [...document.querySelectorAll(".rd-tool")].find((x) => (x.textContent || "").includes("claim"));
    if (b) b.click();
    return true;
  `);
  await sleep(1500);
}

const ui = await evalJs(cdp, `return {
  rd: !!document.querySelector(".rd"),
  errBoundary: (document.body.innerText || "").includes("深读加载失败"),
  evCard: !!document.querySelector(".ev-card"),
  ledgerFilters: !!document.querySelector(".ledger-filters"),
  scaffold: (document.body.innerText || "").includes("分析中"),
};`);
console.log("UI state:", ui);

if (cdp.exceptions.length) {
  console.log("CDP exceptions:");
  for (const ex of cdp.exceptions) {
    const d = ex.exceptionDetails || ex;
    console.log(" -", d.text || d.exception?.description || JSON.stringify(d).slice(0, 200));
  }
}

writeFileSync(path.join(OUT, "ledger-deep-debug.json"), JSON.stringify({ ui, exceptions: cdp.exceptions.length }, null, 2));
cdp.ws.close();
process.exit(ui.errBoundary ? 1 : 0);
