#!/usr/bin/env node
/** 真机烟测：检索会话 keep-alive（切换 Tab 不清空 + Tab 提示 + 恢复） */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts", "find-session");
mkdirSync(OUT, { recursive: true });

const results = [];
const pass = (name, detail = "") => {
  results.push({ ok: true, name, detail });
  console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
};
const fail = (name, detail = "") => {
  results.push({ ok: false, name, detail });
  console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
};

async function getWsUrl() {
  const r = await fetch(`${CDP}/json/list`);
  const list = await r.json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("Electron CDP 未就绪（9222）— 请先 npm run build:electron && npx electron . --remote-debugging-port=9222");
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

async function clickTab(cdp, text) {
  await evalJs(cdp, `
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const t = tabs.find(x => (x.textContent||"").includes(${JSON.stringify(text)}));
    if (!t) throw new Error("tab not found: ${text}");
    t.click();
  `);
}

async function screenshot(cdp, name) {
  try {
    await cdp.send("Page.bringToFront");
    const { data } = await Promise.race([
      cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 82, captureBeyondViewport: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("screenshot timeout")), 35000)),
    ]);
    const fp = path.join(OUT, `${name}.jpg`);
    writeFileSync(fp, Buffer.from(data, "base64"));
    console.log(`  📷 ${fp}`);
    return fp;
  } catch (e) {
    console.log(`  · 截图跳过 ${name}（${e.message}）`);
    return null;
  }
}

async function dismissOnboarding(cdp) {
  return evalJs(cdp, `
    const btn = [...document.querySelectorAll("button")].find(b => /稍后|跳过|关闭|dismiss/i.test(b.textContent||""));
    if (btn) { btn.click(); return true; }
    return false;
  `);
}

async function runSearch(cdp, query) {
  await evalJs(cdp, `
    const inp = document.querySelector(".ff-bar input");
    if (!inp) throw new Error("ff-bar input missing");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, ${JSON.stringify(query)});
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  `);
}

async function waitForCards(cdp, min = 1, maxSec = 45) {
  for (let i = 0; i < maxSec; i++) {
    const n = await evalJs(cdp, `return document.querySelectorAll(".ff-card").length;`);
    if (n >= min) return n;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return evalJs(cdp, `return document.querySelectorAll(".ff-card").length;`);
}

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const ready = await evalJs(cdp, `return !!(window.luminaApi && document.querySelector(".lf-tab"));`);
  if (!ready) fail("BOOT", "应用未就绪");
  else pass("BOOT", "luminaApi + tabs");

  await dismissOnboarding(cdp);
  await clickTab(cdp, "检索取文");
  await new Promise((r) => setTimeout(r, 400));

  await runSearch(cdp, "covid vaccine efficacy");
  const cardsBefore = await waitForCards(cdp, 1, 50);
  if (cardsBefore < 1) fail("SEARCH", "无结果卡片", String(cardsBefore));
  else pass("SEARCH", "命中结果", `${cardsBefore} 张卡片`);

  const sessionBefore = await evalJs(cdp, `
    return {
      submitted: !!document.querySelector(".ff-session-bar"),
      sessionText: document.querySelector(".ff-session-bar")?.innerText?.slice(0, 120) || "",
      hiddenPane: !!document.querySelector(".lf-pane.is-hidden .ff"),
      firstTitle: document.querySelector(".ff-card .ff-title")?.innerText?.slice(0, 80) || "",
      keepAlive: document.querySelectorAll(".lf-pane .ff").length,
    };
  `);
  if (sessionBefore.submitted) pass("SESSION_BAR", sessionBefore.sessionText.slice(0, 60));
  else fail("SESSION_BAR", "未显示会话条");

  await screenshot(cdp, "01-find-results");

  await clickTab(cdp, "我的文献");
  await new Promise((r) => setTimeout(r, 600));

  const away = await evalJs(cdp, `
    const findTab = [...document.querySelectorAll('[role="tab"]')].find(t => (t.textContent||"").includes("检索取文"));
    return {
      findPaneHidden: !!document.querySelector(".lf-pane.is-hidden .ff"),
      findStillMounted: document.querySelectorAll(".lf-pane .ff").length,
      cardsWhileHidden: document.querySelectorAll(".lf-pane.is-hidden .ff-card").length,
      tabHint: findTab?.querySelector(".lf-tab-hint")?.textContent?.trim() || "",
      tabBadge: findTab?.querySelector(".lf-badge-soft")?.textContent?.trim() || "",
      libraryVisible: !!document.querySelector(".lib-body, .lib-empty, .lib-head"),
    };
  `);

  if (away.findStillMounted >= 1) pass("KEEP_ALIVE", "FindFetch 仍挂载", `hidden=${away.findPaneHidden}`);
  else fail("KEEP_ALIVE", "FindFetch 被卸载");

  if (away.cardsWhileHidden >= cardsBefore) pass("STATE_PERSIST", "隐藏时卡片仍在 DOM", `${away.cardsWhileHidden} 张`);
  else fail("STATE_PERSIST", "卡片丢失", `was ${cardsBefore} now ${away.cardsWhileHidden}`);

  if (away.tabHint || away.tabBadge) pass("TAB_HINT", away.tabHint || away.tabBadge);
  else fail("TAB_HINT", "Tab 无会话提示");

  if (away.libraryVisible) pass("LIBRARY_VIEW", "文献库正常显示");
  else fail("LIBRARY_VIEW", "文献库未显示");

  await screenshot(cdp, "02-library-with-tab-hint");

  await clickTab(cdp, "阅读");
  await new Promise((r) => setTimeout(r, 500));
  await screenshot(cdp, "03-read-tab");

  await clickTab(cdp, "检索取文");
  await new Promise((r) => setTimeout(r, 500));

  const restored = await evalJs(cdp, `
    return {
      cards: document.querySelectorAll(".ff-card").length,
      sessionBar: !!document.querySelector(".ff-session-bar"),
      firstTitle: document.querySelector(".ff-card .ff-title")?.innerText?.slice(0, 80) || "",
      findPaneVisible: !document.querySelector(".lf-pane.is-hidden .ff") || !document.querySelector(".lf-pane.is-hidden")?.contains(document.querySelector(".ff")),
      query: document.querySelector(".ff-bar input")?.value || "",
    };
  `);

  if (restored.cards >= cardsBefore) pass("RESTORE", "回到检索结果仍在", `${restored.cards} 张`);
  else fail("RESTORE", "结果丢失", `${restored.cards} < ${cardsBefore}`);

  if (restored.sessionBar) pass("SESSION_BAR_RESTORE", "会话条仍在");
  else fail("SESSION_BAR_RESTORE", "会话条消失");

  if (restored.firstTitle === sessionBefore.firstTitle) pass("SAME_FIRST_HIT", restored.firstTitle.slice(0, 50));
  else pass("SAME_FIRST_HIT", "首条可能重排", `${sessionBefore.firstTitle.slice(0, 30)} → ${restored.firstTitle.slice(0, 30)}`);

  await screenshot(cdp, "04-find-restored");

  const storage = await evalJs(cdp, `
    try {
      const raw = localStorage.getItem("lumina.findFetch.session");
      if (!raw) return { ok: false, reason: "empty" };
      const s = JSON.parse(raw);
      return { ok: true, submitted: s.submitted, count: (s.results||[]).length, hasScroll: s.scrollTop != null };
    } catch (e) { return { ok: false, reason: String(e.message) }; }
  `);
  if (storage.ok && storage.count > 0) pass("LOCAL_STORAGE", `submitted=${storage.submitted?.slice?.(0, 24) || storage.submitted} · ${storage.count} 条`);
  else fail("LOCAL_STORAGE", storage.reason || "无快照");

  cdp.ws.close();
} catch (e) {
  fail("FATAL", e.message);
  try { if (cdp) await screenshot(cdp, "99-error"); } catch { /* ignore */ }
  try { cdp?.ws?.close(); } catch { /* ignore */ }
}

const ng = results.filter((r) => !r.ok).length;
console.log(`\nfind-session smoke: ${results.length - ng}/${results.length} passed`);
console.log(`screenshots → ${OUT}`);
process.exit(ng ? 1 : 0);
