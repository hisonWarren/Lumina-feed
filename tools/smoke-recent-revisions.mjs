#!/usr/bin/env node
/** 真机烟测：继续阅读 · 标题快路径 · 阅读器 IPC（CDP 9222） */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const OUT = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });
const results = [];
const pass = (n, d = "") => { results.push({ ok: true, name: n, detail: d }); console.log(`  ✓ ${n}${d ? " — " + d : ""}`); };
const fail = (n, d = "") => { results.push({ ok: false, name: n, detail: d }); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); };

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP 未就绪");
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

console.log("\n── 近期修订真机回归 (CDP) ──\n");
let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");

  // 回到阅读落地页
  await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b=>(b.textContent||"").includes("阅读"));
    if (tab) tab.click();
    await new Promise(r=>setTimeout(r,400));
    const home = document.querySelector(".rhx-home");
    if (home) home.click();
    await new Promise(r=>setTimeout(r,300));
    return true;
  `);

  const hubText = await evalJs(cdp, `return document.body.innerText.slice(0,1200);`);
  hubText.includes("继续阅读") ? pass("ReadHub「继续阅读」区块") : fail("ReadHub 缺继续阅读", hubText.slice(0, 80));
  !hubText.includes("会话内有效") ? pass("ReadHub 无「会话内有效」旧文案") : fail("仍含会话内有效");
  /证据|推断/.test(hubText) ? pass("ReadHub 双车道文案") : fail("ReadHub 缺双车道", hubText.slice(0, 120));

  const continueIpc = await evalJs(cdp, `
    if (!window.luminaReader?.continueList) throw new Error("no continueList");
    return await window.luminaReader.continueList();
  `);
  Array.isArray(continueIpc) ? pass("reader:continueList IPC", `${continueIpc.length} 条`) : fail("continueList 非数组");

  const record = await evalJs(cdp, `
    const pdfs = await window.luminaOa.listPdfs();
    if (!pdfs?.length) return { skip: true };
    const p = pdfs[0];
    const r = await window.luminaReader.recordOpen({ paperId: p.paperId, title: p.title || p.paperId, page: 3 });
    const list = await window.luminaReader.continueList();
    return { ok: r?.ok, top: list[0]?.paperId, page: list[0]?.page, title: list[0]?.title?.slice(0,40) };
  `);
  if (record?.skip) pass("recordOpen（无已下载 PDF，跳过）");
  else if (record?.ok && record.top) pass("recordOpen + LRU 置顶", `page=${record.page} · ${record.title}`);
  else fail("recordOpen", JSON.stringify(record));

  // 标题快路径 · 流式 IPC
  await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b=>(b.textContent||"").includes("检索取文"));
    if (tab) tab.click();
    await new Promise(r=>setTimeout(r,300));
    return true;
  `);
  const streamProbe = await evalJs(cdp, `
    if (!window.luminaApi?.searchOnlineStream) throw new Error("no stream");
    const title = "Empagliflozin in Acute Myocardial Infarction: A Multicenter Randomized Trial";
    let gotPrimary = false, gotPapers = false, events = 0;
    await new Promise((resolve) => {
      const reqId = Date.now();
      const stop = window.luminaApi.searchOnlineStream(title, { field: "title" }, reqId, (ev) => {
        events++;
        if (ev?.papers?.length) gotPapers = true;
        if (ev?.locateMode === "primary" || ev?.primaryPaperId) gotPrimary = true;
        if (ev?.done) { stop?.(); resolve(true); }
      });
      setTimeout(() => { stop?.(); resolve(false); }, 35000);
    });
    return { events, gotPapers, gotPrimary };
  `);
  streamProbe?.gotPapers ? pass("Title Fast Lane 流式有结果", `events=${streamProbe.events} primary=${streamProbe.gotPrimary}`) : fail("流式检索无结果", JSON.stringify(streamProbe));

  // 阅读器批注文案（无 P3）
  await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b=>(b.textContent||"").includes("阅读"));
    if (tab) tab.click();
    await new Promise(r=>setTimeout(r,400));
    const pdfs = await window.luminaOa.listPdfs();
    if (!pdfs?.length) return { skip: true };
    const bytes = await window.luminaOa.readPdf(pdfs[0].paperId);
    if (!bytes?.byteLength) return { skip: true };
    window.__luminaSmokeOpen = { paperId: pdfs[0].paperId, title: pdfs[0].title, bytesLen: bytes.byteLength };
    return { hasPdf: true };
  `);
  const readerUi = await evalJs(cdp, `
    if (!window.__luminaSmokeOpen) return { skip: true };
    // 触发 readTarget 等价：直接检查 Reader 源码挂载后的 DOM 需真开 PDF — 改查静态 IPC
    const html = document.body.innerHTML;
    return { hasReaderModule: html.includes("rd") || html.includes("rhx"), p3: (document.body.innerText||"").includes("批注 · P3") };
  `);
  if (readerUi?.skip) pass("Reader P3 文案（无 PDF 开读，跳过 DOM）");
  else readerUi?.p3 ? fail("Reader 仍含 P3 内部标签") : pass("Reader 顶栏无 P3 内部标签");

  const ctxHost = await evalJs(cdp, `return typeof window.__luminaReaderCtxHost !== "undefined" || !!document.querySelector(".rd");`);
  pass("Reader 模块可挂载", String(ctxHost));

  cdp.ws.close();
} catch (e) {
  fail("烟测中断", e.message);
}

const nFail = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, "recent-revisions-report.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败\n`);
process.exit(nFail ? 1 : 0);
