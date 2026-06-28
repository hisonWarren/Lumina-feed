#!/usr/bin/env node
/**
 * MAN-OS 真机烟测（CDP 9222）：Find & Fetch 开放源 UX + IPC。
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const fp = path.join(OUT, name);
  writeFileSync(fp, Buffer.from(data, "base64"));
  return fp;
}

console.log("\n── MAN-OS 真机烟测 (CDP) ──\n");

async function waitForApp(cdp, maxSec = 20) {
  for (let i = 0; i < maxSec; i++) {
    const ready = await evalJs(cdp, `
      return document.querySelectorAll(".lf-tab").length > 0 || document.querySelector(".ff-bar input");
    `);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function dismissOnboarding(cdp) {
  return evalJs(cdp, `
    const later = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("稍后"));
    if (later) { later.click(); return "dismissed"; }
    const skip = [...document.querySelectorAll("button")].find(b => /跳过|关闭|知道了/.test(b.textContent||""));
    if (skip) { skip.click(); return "dismissed-alt"; }
    return "none";
  `);
}

async function goFindFetch(cdp) {
  await evalJs(cdp, `
    const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("检索取文"));
    if (!t) throw new Error("find tab missing");
    t.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 500));
}

async function uiSearch(cdp, query) {
  await evalJs(cdp, `
    const inp = document.querySelector(".ff-bar input");
    if (!inp) throw new Error("search input missing");
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(inp, ${JSON.stringify(query)});
    else inp.value = ${JSON.stringify(query)};
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    return true;
  `);
}

async function waitForCards(cdp, maxSec = 35) {
  for (let i = 0; i < maxSec; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const cards = await evalJs(cdp, `return document.querySelectorAll(".ff-card").length;`);
    if (Number(cards) > 0) return Number(cards);
  }
  return 0;
}

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  if (!(await waitForApp(cdp, 15))) fail("BOOT", "应用 UI 未就绪", "无 lf-tab / ff-bar");
  else pass("BOOT", "应用 UI 就绪");

  const ob = await dismissOnboarding(cdp);
  pass("BOOT", "Onboarding 处理", ob);

  await goFindFetch(cdp);

  // MAN-OS8 · 检索深度开关在检索栏旁
  const depth = await evalJs(cdp, `
    const g = document.querySelector('.lf-depth');
    const std = document.querySelector('.lf-depth-opt.on');
    return { hasGroup: !!g, label: std ? std.textContent.trim() : null, count: document.querySelectorAll('.lf-depth-opt').length };
  `);
  depth?.hasGroup && depth.count >= 2
    ? pass("MAN-OS8", "检索深度开关可见", depth.label || "standard/full")
    : fail("MAN-OS8", "缺 lf-depth 检索深度", JSON.stringify(depth));

  // MAN-OS3/4/5/9 · UI 流式检索
  await uiSearch(cdp, "covid vaccine");
  const cards = await waitForCards(cdp, 45);
  cards > 0 ? pass("MAN-OS3", "UI 检索渲染结果卡", `${cards} 张`) : fail("MAN-OS3", "UI 未渲染 ff-card");

  const srcBar = await evalJs(cdp, `
    const s = document.querySelector('.lf-src-summary .sum');
    return s ? s.textContent.trim() : null;
  `);
  srcBar && /源/.test(srcBar) && /命中/.test(srcBar)
    ? pass("MAN-OS4", "来源条汇总格式", srcBar)
    : fail("MAN-OS4", "来源条汇总", String(srcBar));

  const hasExpand = await evalJs(cdp, `return !!document.querySelector('.lf-src-summary');`);
  hasExpand ? pass("MAN-OS4", "来源条可展开控件") : fail("MAN-OS4", "缺 lf-src-summary");

  const titles1 = await evalJs(cdp, `
    return [...document.querySelectorAll(".ff-card")].slice(0,3).map(c => (c.querySelector(".ff-title")?.textContent||"").trim());
  `);
  await new Promise((r) => setTimeout(r, 3000));
  const titles2 = await evalJs(cdp, `
    return [...document.querySelectorAll(".ff-card")].slice(0,3).map(c => (c.querySelector(".ff-title")?.textContent||"").trim());
  `);
  if (titles1?.length >= 2 && titles2?.length >= 2) {
    const stable = titles1.every((t, i) => t && t === titles2[i]);
    stable ? pass("MAN-OS5", "Top3 标题 3s 内保位", titles1[0]?.slice(0, 40)) : fail("MAN-OS5", "Top3 抖动", titles1.join(" | ") + " → " + titles2.join(" | "));
  } else skip("MAN-OS5", "列表保位", "结果不足 2 条");

  const pendingBtn = await evalJs(cdp, `
    return [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("刷新排序"));
  `);
  pendingBtn ? pass("MAN-OS5", "刷新排序按钮存在") : skip("MAN-OS5", "刷新排序按钮", "无 pending 时可能隐藏");

  const gs = await evalJs(cdp, `
    const b = document.querySelector('.lf-gs-link');
    return b ? b.textContent.trim() : null;
  `);
  gs && /Google Scholar/i.test(gs)
    ? pass("MAN-OS9", "GS 外链在结果区", gs)
    : fail("MAN-OS9", "缺 lf-gs-link");

  // MAN-OS3 · IPC 源参与（S2/DOAJ/DataCite）
  const t0 = Date.now();
  const raw = await evalJs(cdp, `
    if (!window.luminaApi?.searchOnline) throw new Error("no searchOnline");
    return await window.luminaApi.searchOnline("transformer attention", { limit: 8, depth: "standard" });
  `);
  const ms = Date.now() - t0;
  const papers = raw?.papers?.length ?? 0;
  const perSource = raw?.perSource ?? {};
  const srcKeys = Object.keys(perSource);
  papers > 0
    ? pass("MAN-OS3", "searchOnline 有结果", `${papers} 篇 · ${srcKeys.length} 源 · ${ms}ms`)
    : fail("MAN-OS3", "searchOnline 无结果", JSON.stringify(raw).slice(0, 120));

  const hitS2 = srcKeys.includes("semanticscholar");
  const hitDoaj = srcKeys.includes("doaj");
  const hitDc = srcKeys.includes("datacite");
  hitS2 ? pass("MAN-OS3", "Semantic Scholar 参与", String(perSource.semanticscholar?.count ?? 0) + " 条") : fail("MAN-OS3", "缺 semanticscholar");
  hitDoaj ? pass("MAN-OS3", "DOAJ 参与", String(perSource.doaj?.count ?? 0) + " 条") : fail("MAN-OS3", "缺 doaj");
  hitDc ? pass("MAN-OS3", "DataCite 参与", String(perSource.datacite?.count ?? 0) + " 条") : fail("MAN-OS3", "缺 datacite");

  // MAN-OS7 · 设置数据源面板
  await evalJs(cdp, `document.querySelector('.lf-icon[aria-label="设置"]')?.click();`);
  await new Promise((r) => setTimeout(r, 500));
  await evalJs(cdp, `
    const src = [...document.querySelectorAll(".set-railbtn")].find(b => (b.textContent||"").includes("数据源"));
    if (src) src.click();
    return !!src;
  `);
  await new Promise((r) => setTimeout(r, 400));
  const srcPanel = await evalJs(cdp, `
    const t = document.body.innerText;
    return { hasCore: t.includes("CORE"), hasLens: t.includes("Lens"), hasTest: [...document.querySelectorAll("button")].some(b=>(b.textContent||"").includes("测试")) };
  `);
  srcPanel?.hasCore && srcPanel?.hasLens
    ? pass("MAN-OS7", "设置·数据源面板", srcPanel.hasTest ? "含测试按钮" : "无测试按钮")
    : fail("MAN-OS7", "数据源面板", JSON.stringify(srcPanel));

  // MAN-OS11 · settings 不回显 key
  const settings = await evalJs(cdp, `return await window.luminaApi.getSettings();`);
  const leaked = settings && JSON.stringify(settings).match(/sk-[a-z0-9]{20,}|Bearer [A-Za-z0-9]{20,}/i);
  !leaked
    ? pass("MAN-OS11", "settings 无明文 Key 模式")
    : fail("MAN-OS11", "settings 疑似含 Key");

  await screenshot(cdp, "man-os-findfetch").catch(() => {});
  try { cdp.ws.close(); } catch { /* ignore */ }
} catch (e) {
  fail("BOOT", "烟测中断", e.message);
}

const nFail = results.filter((r) => !r.ok && !r.skipped).length;
writeFileSync(path.join(OUT, "man-os-report.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败`);
console.log(`报告：${path.join(OUT, "man-os-report.json")}\n`);
process.exit(nFail ? 1 : 0);
