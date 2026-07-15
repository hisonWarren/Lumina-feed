#!/usr/bin/env node
/**
 * v0.4.97 真机烟测（CDP 9222）：批注 flush/合并、Ask 外部模式 UI、专注模式藏顶栏。
 * 需：npm run build:electron && npx electron . --remote-debugging-port=9222
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const results = [];
const pass = (id, name, detail = "") => {
  results.push({ id, ok: true, name, detail });
  console.log(`  ✓ ${id} ${name}${detail ? " — " + detail : ""}`);
};
const fail = (id, name, detail = "") => {
  results.push({ id, ok: false, name, detail });
  console.log(`  ✗ ${id} ${name}${detail ? " — " + detail : ""}`);
};
const skip = (id, name, detail = "") => {
  results.push({ id, ok: true, name, detail: "SKIP: " + detail, skipped: true });
  console.log(`  ○ ${id} ${name} — 跳过：${detail}`);
};

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("Electron CDP 未就绪（9222）");
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text + (exceptionDetails.exception?.description || ""));
  return result.value;
}

async function dismissOnboarding(cdp) {
  await evalJs(cdp, `
    const later = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("稍后"));
    if (later) later.click();
  `);
}

async function openReader(cdp) {
  return evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("阅读"));
    if (tab) tab.click();
    await new Promise(r => setTimeout(r, 500));
    document.querySelector(".rd-back")?.click();
    await new Promise(r => setTimeout(r, 250));
    document.querySelector(".rhx-home")?.click();
    await new Promise(r => setTimeout(r, 450));
    // 1) 继续阅读：跳过 missing
    let row = [...document.querySelectorAll(".rh-row")].find(r => !r.classList.contains("missing"));
    // 2) 展开全部已下载
    if (!row) {
      const expand = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("展开") || (b.getAttribute("aria-expanded")==="false"));
      const toggle = document.querySelector(".rh-toggle");
      if (toggle) toggle.click();
      await new Promise(r => setTimeout(r, 400));
      const secs = [...document.querySelectorAll(".rh-sec")];
      const dlSec = secs.find(s => (s.textContent||"").includes("全部已下载"));
      row = dlSec && [...dlSec.querySelectorAll(".rh-row")].find(r => !r.classList.contains("missing"));
    }
    if (!row) {
      const toggle = document.querySelector(".rh-toggle");
      if (toggle) toggle.click();
      await new Promise(r => setTimeout(r, 500));
      row = [...document.querySelectorAll(".rh-row")].find(r => !r.classList.contains("missing"));
    }
    if (!row) return { ok: false, reason: "no_openable_pdf_rows" };
    row.click();
    for (let i = 0; i < 60 && !document.querySelector(".rd"); i++) await new Promise(r => setTimeout(r, 400));
    if (!document.querySelector(".rd")) return { ok: false, reason: "reader_not_open", clicked: (row.querySelector(".nm")||{}).textContent || "" };
    document.querySelector(".rd-tp-h .rd-x")?.click();
    await new Promise(r => setTimeout(r, 150));
    for (let i = 0; i < 40 && !document.querySelector(".textLayer span"); i++) await new Promise(r => setTimeout(r, 400));
    return { ok: true, hasText: !!document.querySelector(".textLayer span"), name: (document.querySelector(".rd-name")||{}).textContent || "" };
  `);
}

async function main() {
  console.log("\n── v0.4.97 阅读器体验真机烟测 (CDP) ──\n");
  const wsUrl = await getWsUrl();
  const cdp = await cdpConnect(wsUrl);
  await cdp.send("Runtime.enable");
  await new Promise((r) => setTimeout(r, 1200));
  await dismissOnboarding(cdp);

  const opened = await openReader(cdp);
  if (!opened || !opened.ok) {
    fail("R097-open", "打开 PDF", opened?.reason || "无可用 PDF");
  } else {
    pass("R097-open", "打开文献", opened.name || (opened.hasText ? "有文本层" : "已打开"));
  }

  // Annotations IPC (不依赖 PDF UI)
  const anno = await evalJs(cdp, `
    const api = window.luminaAnno;
    if (!api || !api.getMerged || !api.save) return { ok: false, reason: "no_luminaAnno_getMerged" };
    const key = "smoke:v0497:" + Date.now();
    const alt = key + ":alt";
    const sample = [{ id: "a1", type: "highlight", page: 1, color: "#ff0", rects: [{x:1,y:1,w:10,h:10}], anchoredText: "smoke", note: "", createdAt: new Date().toISOString() }];
    await api.save(alt, sample);
    const merged = await api.getMerged(key, [alt, key]);
    const okMerge = Array.isArray(merged) && merged.some(x => x && x.id === "a1");
    const sample2 = [{ ...sample[0], id: "a2", note: "flush" }];
    await api.save(key, sample2);
    const got = await api.get(key);
    const okFlush = Array.isArray(got) && got.some(x => x && x.id === "a2");
    return { ok: okMerge && okFlush, okMerge, okFlush, mergedN: (merged||[]).length, gotN: (got||[]).length };
  `);
  if (anno?.ok) pass("R097-anno", "批注 getMerged + 即时 save/get", `merged=${anno.mergedN} got=${anno.gotN}`);
  else fail("R097-anno", "批注 IPC", JSON.stringify(anno));

  // Settings regression
  const settings = await evalJs(cdp, `
    document.querySelector(".rd-focus-exit")?.click();
    document.querySelector(".set-close")?.click();
    await new Promise(r => setTimeout(r, 200));
    const gear = [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label")==="设置" || b.title==="设置");
    if (!gear) return { ok: false, reason: "no_gear" };
    gear.click();
    await new Promise(r => setTimeout(r, 800));
    const modal = !!document.querySelector(".set-modal");
    document.querySelector(".set-close")?.click();
    await new Promise(r => setTimeout(r, 300));
    return { ok: modal };
  `);
  if (settings?.ok) pass("R097-settings", "设置弹窗不白屏");
  else fail("R097-settings", "设置", JSON.stringify(settings));

  if (opened?.ok) {
    // Focus mode
    const focus = await evalJs(cdp, `
      const btn = [...document.querySelectorAll(".rd-btn")].find(b => (b.title||"").includes("专注"));
      if (!btn) return { ok: false, reason: "no_focus_btn" };
      btn.click();
      await new Promise(r => setTimeout(r, 350));
      const rd = document.querySelector(".rd");
      const tabsEl = document.querySelector(".rhx-tabs");
      const tabsHidden = !tabsEl || getComputedStyle(tabsEl).display === "none" || !!document.querySelector(".rhx.focus-reading");
      const toolbar = document.querySelector(".rd-toolbar");
      const toolbarHidden = !toolbar || getComputedStyle(toolbar).display === "none";
      const exit = !!document.querySelector(".rd-focus-exit");
      return { ok: rd?.classList.contains("focus"), tabsHidden, toolbarHidden, exit };
    `);
    if (focus?.ok && focus.toolbarHidden && focus.exit) pass("R097-focus", "专注模式藏工具栏+退出钮", JSON.stringify({ tabs: focus.tabsHidden }));
    else fail("R097-focus", "专注模式", JSON.stringify(focus));

    await evalJs(cdp, `
      document.querySelector(".rd-focus-exit")?.click();
      await new Promise(r => setTimeout(r, 200));
    `);

    const ask = await evalJs(cdp, `
      const assist = [...document.querySelectorAll(".rd-btn")].find(b => (b.textContent||"").includes("助手") || (b.title||"").includes("助手"));
      if (assist) assist.click();
      await new Promise(r => setTimeout(r, 500));
      const modes = [...document.querySelectorAll(".rd-ask-mode button")].map(b => (b.textContent||"").trim());
      const gen = [...document.querySelectorAll(".rd-ask-mode button")].find(b => (b.textContent||"").includes("外部"));
      if (gen) gen.click();
      await new Promise(r => setTimeout(r, 200));
      const onGeneral = !!document.querySelector(".rd-ask-mode button.on") && (document.querySelector(".rd-ask-mode button.on").textContent||"").includes("外部");
      const paper = [...document.querySelectorAll(".rd-ask-mode button")].find(b => (b.textContent||"").includes("仅据本文"));
      if (paper) paper.click();
      return { modes, onGeneral, hasCompose: !!document.querySelector(".rd-assist-compose") };
    `);
    if (ask?.modes?.includes("仅据本文") && ask?.modes?.some((m) => m.includes("外部")) && ask.onGeneral)
      pass("R097-ask-mode", "Ask 模式切换 UI", ask.modes.join(" | "));
    else fail("R097-ask-mode", "Ask 模式 UI", JSON.stringify(ask));
  } else {
    skip("R097-focus", "专注模式", "无打开的阅读器");
    skip("R097-ask-mode", "Ask 模式", "无打开的阅读器");
  }

  const failed = results.filter((r) => !r.ok).length;
  const ok = results.filter((r) => r.ok).length;
  writeFileSync(path.join(OUT, "smoke-v0497.json"), JSON.stringify({ results, ok, failed }, null, 2));
  console.log(`\n── 结果：${ok} 通过 · ${failed} 失败 ──\n`);
  cdp.ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
