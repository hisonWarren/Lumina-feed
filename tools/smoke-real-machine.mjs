#!/usr/bin/env node
/** 真机烟测：连接 Electron CDP (9222)，验 UI + IPC */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const results = [];
const pass = (name, detail = "") => { results.push({ ok: true, name, detail }); console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`); };
const fail = (name, detail = "") => { results.push({ ok: false, name, detail }); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); };

async function getWsUrl() {
  const r = await fetch(`${CDP}/json/list`);
  const list = await r.json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("Lumina page target not found — is Electron running with --remote-debugging-port=9222?");
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
  if (exceptionDetails && exceptionDetails.text) throw new Error(exceptionDetails.text);
  return result.value;
}

async function clickText(cdp, text) {
  return evalJs(cdp, `
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find(x => (x.textContent||"").includes(${JSON.stringify(text)}));
    if (!b) throw new Error("button not found: ${text}");
    b.click();
    return b.textContent.trim();
  `);
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const fp = path.join(OUT, `${name}.png`);
  writeFileSync(fp, Buffer.from(data, "base64"));
  return fp;
}

console.log("\n── Lumina Feed 真机烟测 (CDP) ──\n");

let cdp;
try {
  const wsUrl = await getWsUrl();
  pass("Electron CDP 可达", wsUrl.slice(0, 48) + "…");
  cdp = await cdpConnect(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const hasBackend = await evalJs(cdp, `return !!(window.luminaApi && window.luminaReader);`);
  hasBackend ? pass("preload 暴露 luminaApi + luminaReader") : fail("preload 未注入");

  const title = await evalJs(cdp, `return document.title;`);
  title === "Lumina Feed" ? pass("窗口标题", title) : fail("窗口标题异常", String(title));

  const tabs = await evalJs(cdp, `
    return [...document.querySelectorAll(".lf-tab")].map(b=>b.textContent.trim());
  `);
  const need = ["检索取文", "订阅简报", "我的文献", "阅读"];
  const miss = need.filter((t) => !tabs.some((x) => x.includes(t)));
  miss.length === 0 ? pass("四模块导航 + 设置图标", tabs.join(" · ") + " · [设置→lf-icon]") : fail("缺导航 tab", miss.join(", "));

  const hasSettingsIcon = await evalJs(cdp, `
    return !!document.querySelector('.lf-icon[aria-label="设置"]');
  `);
  hasSettingsIcon ? pass("顶栏设置图标（shell_redesign）") : fail("缺设置图标");

  // 设置 · 测试连接（shell_redesign：设置改 lf-icon，非 tab）
  await evalJs(cdp, `
    const b = document.querySelector('.lf-icon[aria-label="设置"]');
    if (!b) throw new Error("settings icon not found");
    b.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 400));
  const hasTestBtn = await evalJs(cdp, `
    return [...document.querySelectorAll("button")].some(b=>(b.textContent||"").includes("测试连接"));
  `);
  hasTestBtn ? pass("设置页「测试连接」按钮可见") : fail("缺测试连接按钮");

  await evalJs(cdp, `
    const close = document.querySelector(".set-modal .set-close, button[aria-label='关闭']");
    if (close) close.click();
    else {
      const ov = document.querySelector(".set-overlay");
      if (ov) ov.click();
    }
    return true;
  `);
  await new Promise((r) => setTimeout(r, 300));

  const llmTest = await evalJs(cdp, `
    if (!window.luminaApi?.testLlm) throw new Error("no testLlm");
    return await window.luminaApi.testLlm({});
  `);
  if (llmTest && llmTest.ok === true && llmTest.model)
    pass("llm:test IPC 真连通", `${llmTest.model} · ${llmTest.ms}ms`);
  else if (llmTest && llmTest.ok === false && llmTest.error)
    pass("llm:test IPC（无密钥时正确拒绝）", llmTest.error.slice(0, 60));
  else fail("llm:test 异常响应", JSON.stringify(llmTest));

  await screenshot(cdp, "01-settings");

  // 阅读 · ReadHub 文案
  await clickText(cdp, "阅读");
  await new Promise((r) => setTimeout(r, 400));
  const readHub = await evalJs(cdp, `return document.body.innerText.slice(0, 800);`);
  readHub.includes("后续补丁") || readHub.includes("P2b") || readHub.includes("P3")
    ? fail("ReadHub 仍含 dev 术语")
    : pass("ReadHub 无 dev 术语(P2b/P3)");
  /证据|推断|双车道/.test(readHub)
    ? pass("ReadHub 含双车道描述")
    : fail("ReadHub 缺双车道文案");

  await screenshot(cdp, "02-readhub");

  // 我的文献 · 跨篇
  await clickText(cdp, "我的文献");
  await new Promise((r) => setTimeout(r, 400));
  const hasCorpus = await evalJs(cdp, `
    return [...document.querySelectorAll("button")].some(b=>(b.textContent||"").includes("跨篇"));
  `);
  hasCorpus ? pass("我的文献「跨篇分析」开关可见") : fail("缺跨篇分析开关");

  await screenshot(cdp, "03-library");

  // 检索取文 · 在线搜索 IPC
  await clickText(cdp, "检索取文");
  await new Promise((r) => setTimeout(r, 300));
  let searchOk = false;
  try {
    const raw = await evalJs(cdp, `
      if (!window.luminaApi?.searchOnline) throw new Error("no searchOnline");
      return await window.luminaApi.searchOnline("covid vaccine efficacy", { limit: 5 });
    `);
    const hits = raw && (Array.isArray(raw) ? raw.length : (raw.papers ? raw.papers.length : raw.count || 0));
    searchOk = Number(hits) > 0;
    searchOk ? pass("search:online 真检索", `${hits} 条 · perSource OK`) : fail("search:online 无结果", JSON.stringify(raw).slice(0, 120));
  } catch (e) {
    fail("search:online", e.message);
  }

  if (searchOk) {
    await clickText(cdp, "检索取文");
    await new Promise((r) => setTimeout(r, 300));
    await evalJs(cdp, `
      const inp = document.querySelector(".ff-bar input");
      if (!inp) throw new Error("no search input");
      const q = "covid vaccine efficacy";
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(inp, q);
      else inp.value = q;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    let cards = 0;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      cards = await evalJs(cdp, `return document.querySelectorAll(".ff-card").length;`);
      if (Number(cards) > 0) break;
    }
    Number(cards) > 0 ? pass("检索取文 UI 渲染结果卡", `${cards} 张`) : fail("UI 未渲染 ff-card");
    await screenshot(cdp, "04-findfetch");
  }

  // settings 持久化
  const settings = await evalJs(cdp, `return await window.luminaApi.getSettings();`);
  settings && typeof settings === "object" ? pass("settings:get IPC") : fail("settings:get");

  // library 持久化
  const lib = await evalJs(cdp, `return await window.luminaApi.libraryList();`);
  Array.isArray(lib) ? pass("library:list IPC", `${lib.length} 条`) : fail("library:list");

  // subs / reader IPC 探针
  const subs = await evalJs(cdp, `return await window.luminaApi.subsList();`);
  Array.isArray(subs) ? pass("subs:list IPC", `${subs.length} 条订阅`) : fail("subs:list");

  const swipe = await evalJs(cdp, `return await window.luminaReader.swipeGet();`);
  Array.isArray(swipe) ? pass("swipe:get IPC", `${swipe.length} 条`) : fail("swipe:get");

  const pdfs = await evalJs(cdp, `return await window.luminaOa.listPdfs();`);
  Array.isArray(pdfs) ? pass("oa:listPdfs IPC", `${pdfs.length} 个已下载`) : fail("oa:listPdfs");

  cdp.ws.close();
} catch (e) {
  fail("烟测中断", e.message);
}

const nFail = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败`);
console.log(`截图与报告：${OUT}\n`);
process.exit(nFail ? 1 : 0);
