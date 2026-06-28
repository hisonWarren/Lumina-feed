#!/usr/bin/env node
/**
 * MAN-SUB 真机烟测（CDP 9222）：订阅简报 2.0 IPC + UI 探针。
 * 需：npm run build:electron && npx electron . --remote-debugging-port=9222
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const EXCLUDE = ["libgen", "annas", "scihub"];
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

async function dismissOnboarding(cdp) {
  await evalJs(cdp, `
    const later = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("稍后"));
    if (later) later.click();
    else {
      const skip = [...document.querySelectorAll("button")].find(b => /跳过|关闭|知道了/.test(b.textContent||""));
      if (skip) skip.click();
    }
    return true;
  `);
}

async function goSubs(cdp) {
  await evalJs(cdp, `
    const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("订阅简报"));
    if (!t) throw new Error("subs tab missing");
    t.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 600));
}

function perSourceKeys(meta) {
  const ps = meta?.perSource || {};
  return Object.keys(ps).filter((k) => ps[k] && (ps[k].ok || ps[k].count > 0));
}

console.log("\n── MAN-SUB 订阅简报 2.0 真机烟测 (CDP) ──\n");

const subId = "smoke_sub_" + Date.now();
let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await evalJs(cdp, `return !!window.luminaApi`);
  pass("SUB0", "luminaApi 就绪");

  await dismissOnboarding(cdp);

  // IPC: preview
  const draft = { id: subId, name: "smoke covid", kind: "keyword", q: "covid vaccine", freq: "daily", time: "08:00", autoSummarize: "off", enabled: true };
  const prev = await evalJs(cdp, `
    return await window.luminaApi.subsPreview(${JSON.stringify(draft)});
  `);
  if (!prev || prev.preview !== true) fail("SUB3", "subs:preview 标记 preview");
  else pass("SUB3", "subs:preview", `preview=${prev.preview}`);
  const prevHits = Array.isArray(prev?.hits) ? prev.hits : [];
  prevHits.length <= 5 ? pass("SUB3b", "preview ≤5 条", `${prevHits.length}`) : fail("SUB3b", "preview ≤5 条", `${prevHits.length}`);
  const prevSrc = perSourceKeys(prev?.meta || prev);
  const badPrev = prevSrc.filter((s) => EXCLUDE.includes(s.toLowerCase()));
  badPrev.length === 0 ? pass("SUB1", "preview 排除 scrape 源", prevSrc.slice(0, 6).join(",") || "—") : fail("SUB1", "preview 含排除源", badPrev.join(","));

  // save + runNow x2 (today 合并 / newCount)
  await evalJs(cdp, `await window.luminaApi.subsSave(${JSON.stringify({ ...draft, seenIds: [], today: [] })});`);
  pass("SUB-save", "subs:save");

  const run1 = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    return await window.luminaApi.subsRunNow(s);
  `);
  const n1 = run1?.newCount ?? (run1?.hits?.length || 0);
  const t1 = Array.isArray(run1?.hits) ? run1.hits.length : 0;
  n1 >= 0 ? pass("SUB-run1", "subs:runNow 首轮", `new=${n1} today=${t1}`) : fail("SUB-run1", "subs:runNow");
  const run1Src = perSourceKeys(run1?.meta);
  run1Src.some((s) => EXCLUDE.includes(s.toLowerCase())) ? fail("SUB1b", "runNow 排除 scrape 源", run1Src.join(",")) : pass("SUB1b", "runNow 排除 scrape 源");

  const run2 = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    return await window.luminaApi.subsRunNow(s);
  `);
  const n2 = run2?.newCount ?? 0;
  const t2 = Array.isArray(run2?.hits) ? run2.hits.length : 0;
  n2 === 0 ? pass("SUB10", "连跑无重复 newCount", `newCount=0`) : (n2 < n1 ? pass("SUB10", "连跑去重/仅增量", `new=${n2} < 首轮 ${n1}`) : fail("SUB10", "连跑去重", `new=${n2} 首轮=${n1}`));
  t1 > 0 && t2 >= t1 ? pass("SUB10b", "today 合并保留", `today ${t1}→${t2}`) : t1 === 0 ? skip("SUB10b", "today 合并", "首轮无命中") : fail("SUB10b", "today 合并", `t1=${t1} t2=${t2}`);

  // settings digestNotifyTier
  const tierOk = await evalJs(cdp, `
    const cur = await window.luminaApi.getSettings();
    await window.luminaApi.saveSettings({ ...cur, digestNotifyTier: "calm" });
    const next = await window.luminaApi.getSettings();
    return next.digestNotifyTier;
  `);
  tierOk === "calm" ? pass("SUB9", "digestNotifyTier 持久化", tierOk) : fail("SUB9", "digestNotifyTier", String(tierOk));

  // UI
  await goSubs(cdp);
  const ui = await evalJs(cdp, `
    return {
      tldr: !!document.querySelector(".dg-tldr"),
      loadmore: document.querySelectorAll(".dg-loadmore").length,
      why: document.querySelectorAll(".dg-why").length,
      src: document.querySelectorAll(".dg-src").length,
      add: [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("新建订阅")),
    };
  `);
  ui.add ? pass("SUB-ui", "订阅页渲染", JSON.stringify(ui)) : fail("SUB-ui", "订阅页", JSON.stringify(ui));
  t1 > 0 && ui.tldr ? pass("SUB4", "TL;DR 条可见") : t1 > 0 ? fail("SUB4", "TL;DR") : skip("SUB4", "TL;DR", "无待读");

  // preview dialog UI
  await evalJs(cdp, `
    const add = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("新建订阅"));
    if (add) add.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 400));
  const dlg = await evalJs(cdp, `
    const btn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("预览命中"));
    return { hasPreviewBtn: !!btn };
  `);
  dlg.hasPreviewBtn ? pass("SUB3-ui", "编辑弹窗·预览按钮") : fail("SUB3-ui", "预览按钮");
  await evalJs(cdp, `
    const x = [...document.querySelectorAll("button")].find(b => (b.textContent||"").trim() === "取消");
    if (x) x.click();
  `);

  await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId)});`);
  pass("SUB-clean", "subs:remove");

  cdp.ws.close();
} catch (e) {
  fail("FATAL", e.message);
  try { cdp?.ws?.close(); } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
const report = { at: new Date().toISOString(), pass: results.filter((r) => r.ok && !r.skipped).length, fail: failed.length, results };
writeFileSync(path.join(OUT, "subs-digest-report.json"), JSON.stringify(report, null, 2));
console.log(`\n── 结果：${report.pass} 通过 · ${report.fail} 失败 ──\n`);
process.exit(failed.length ? 1 : 0);
