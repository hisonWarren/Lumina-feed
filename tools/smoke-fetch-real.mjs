#!/usr/bin/env node
/** 真机 · 获取全文验证：外网探针 + CDP UI 取文 + 截图 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts", "fetch-real");
mkdirSync(OUT, { recursive: true });

const CASES = [
  { label: "arxiv-attention", doi: "10.48550/arXiv.1706.03762", expect: "arxiv" },
  { label: "bmc-oa", doi: "10.1186/s12915-024-01886-3", expect: "pmc|europepmc|publisher" },
];

const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => console.log(`  ✗ ${n}${d ? " — " + d : ""}`);

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP 9222 未就绪 — 请 npm run build:electron && npx electron . --remote-debugging-port=9222 --disable-gpu");
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

async function screenshot(cdp, name) {
  try {
    await cdp.send("Page.bringToFront");
    const { data } = await Promise.race([
      cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 85 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 35000)),
    ]);
    const fp = path.join(OUT, `${name}.jpg`);
    writeFileSync(fp, Buffer.from(data, "base64"));
    console.log(`  📷 ${fp}`);
    return fp;
  } catch (e) {
    console.log(`  · 截图跳过 ${name}: ${e.message}`);
    return null;
  }
}

async function probeArxivNetwork() {
  try {
    const res = await fetch("https://arxiv.org/pdf/1706.03762.pdf", {
      method: "HEAD",
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, status: res.status, ct: res.headers.get("content-type") };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

let ng = 0;
const net = await probeArxivNetwork();
if (net.ok) pass("外网探针 arxiv PDF", `HTTP ${net.status} · ${net.ct || ""}`);
else { fail("外网探针 arxiv PDF", net.error || String(net.status)); ng++; }

const cdp = await cdpConnect(await getWsUrl());
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

await evalJs(cdp, `
  const cur = await window.luminaApi.getSettings()||{};
  if (!cur.contactEmail) await window.luminaApi.saveSettings({...cur, contactEmail:'wxs_insist@163.com'});
`);

await evalJs(cdp, `
  [...document.querySelectorAll('[role="tab"]')].find(t=>(t.textContent||'').includes('检索取文'))?.click();
`);
await new Promise((r) => setTimeout(r, 400));

for (const c of CASES) {
  console.log(`\n── ${c.label} · ${c.doi} ──`);
  const resolved = await evalJs(cdp, `return await window.luminaApi.searchOnline(${JSON.stringify(c.doi)}, {});`);
  const p = resolved?.papers?.[0];
  if (!p) { fail("解析", "无文献"); ng++; continue; }
  pass("解析", `${resolved.locateMode} · ${(p.title || "").slice(0, 55)}`);

  const reqId = Date.now();
  const traceLog = [];
  const fetchPromise = evalJs(cdp, `
    return await new Promise((resolve) => {
      const reqId = ${reqId};
      const log = [];
      const stop = window.luminaOa.fetchPaperStream(${JSON.stringify(p.id)}, reqId, (ev) => {
        if (ev && ev.steps) log.push(ev.steps.map(s => s.id+':'+s.status+(s.detail?('('+s.detail+')'):'')).join(' | '));
        if (ev && (ev.type === 'done' || ev.type === 'final')) { stop && stop(); resolve({ log, result: ev.result || ev.result, steps: ev.steps }); }
      });
      setTimeout(() => resolve({ log, result: { ok: false, reason: 'timeout_120s' } }), 120000);
    });
  `);

  const t0 = Date.now();
  const fr = await fetchPromise;
  const ms = Date.now() - t0;

  if (fr?.result?.ok) {
    pass("fetchPaper", `${fr.result.source} · ${ms}ms · cached=${!!fr.result.cached}`);
    if (fr.log?.length) console.log("    trace:", fr.log[fr.log.length - 1]?.slice(0, 200));
  } else {
    fail("fetchPaper", `${fr?.result?.reason || "unknown"} · ${ms}ms`);
    if (fr?.log?.length) console.log("    trace:", fr.log.join("\n           "));
    ng++;
  }

  const bytes = await evalJs(cdp, `
    try {
      const b = await window.luminaOa.readPdf(${JSON.stringify(p.id)});
      return b ? b.byteLength : 0;
    } catch { return 0; }
  `);
  if (bytes > 1000) pass("readPdf", `${bytes} bytes`);
  else { fail("readPdf", String(bytes)); ng++; }
}

// UI 路径：关键词检索 + 点「获取全文」
console.log("\n── UI 路径 · covid vaccine efficacy ──");
await evalJs(cdp, `
  const inp = document.querySelector('.ff-bar input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(inp, 'covid vaccine efficacy');
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
`);
for (let i = 0; i < 50; i++) {
  const n = await evalJs(cdp, `return document.querySelectorAll('.ff-card').length;`);
  if (n >= 1) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const cardTitle = await evalJs(cdp, `return document.querySelector('.ff-card .ff-title')?.innerText?.slice(0,60)||'';`);
pass("UI 检索", cardTitle || "无卡片");

const btnState = await evalJs(cdp, `
  const card = document.querySelector('.ff-card');
  const id = card?.getAttribute('data-paper-id');
  const btn = card?.querySelector('.ff-act.ff-ft');
  if (btn && !btn.disabled && !(btn.textContent||'').includes('阅读')) { btn.click(); return { clicked: true, id }; }
  return { clicked: false, id, text: btn?.textContent?.trim() };
`);
if (btnState.clicked) pass("UI 点击获取全文", btnState.id);
else fail("UI 点击获取全文", btnState.text || "未点击");

let uiOk = false;
for (let i = 0; i < 90; i++) {
  const st = await evalJs(cdp, `
    const btn = document.querySelector('.ff-card .ff-act.ff-ft');
    return { text: btn?.textContent?.trim()||'', loading: btn?.classList.contains('loading') };
  `);
  if ((st.text || "").includes("阅读") || (st.text || "").includes("已取")) { uiOk = true; break; }
  if (!st.loading && i > 5 && !(st.text || "").includes("获取")) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (uiOk) pass("UI 取文完成", "主按钮变为阅读");
else { fail("UI 取文完成", "超时或仍在 loading"); ng++; }

await screenshot(cdp, "ui-fetch-result");
cdp.ws.close();

console.log(`\nfetch-real: ${CASES.length * 3 + 3 - ng}/${CASES.length * 3 + 3} checks · screenshots → ${OUT}`);
process.exit(ng ? 1 : 0);
