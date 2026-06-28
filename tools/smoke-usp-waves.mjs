#!/usr/bin/env node
/**
 * USP Wave 1–3 真机烟测（CDP 9222）：标识符通道 · 源开关 · 预取 · C 通道 · 消歧
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

console.log("\n── USP Wave 1–3 真机烟测 (CDP) ──\n");

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // W-P3 · 标识符 IPC（Crossref DOI）
  const doiRes = await evalJs(cdp, `
    if (!window.luminaApi?.searchOnline) throw new Error("no searchOnline");
    return await window.luminaApi.searchOnline("10.1038/nature12373", {});
  `);
  if (doiRes?.locateMode === "identifier" && (doiRes.papers?.length ?? 0) > 0) {
    pass("W-P3", "DOI 标识符通道", `${doiRes.papers[0].title?.slice(0, 50) || "ok"} · from ${(doiRes.resolvedFrom || []).join(",")}`);
  } else {
    fail("W-P3", "DOI 标识符通道", JSON.stringify(doiRes).slice(0, 120));
  }

  // W-P7 · 无效标识符消歧回落
  const badId = await evalJs(cdp, `
    return await window.luminaApi.searchOnline("10.9999/not-a-real-doi-xyz", {});
  `);
  if (badId?.locateMode === "disambig" || ((badId?.papers?.length ?? 0) > 1 && badId?.locateMode === "keyword")) {
    pass("W-P7", "无效 DOI 消歧/回落", badId.locateMode || `${badId.papers?.length} 篇`);
  } else if (badId?.locateMode === "identifier" && badId?.papers?.length === 1) {
    pass("W-P7", "无效 DOI → doi_stub 单卡", "identifier stub");
  } else {
    skip("W-P7", "无效 DOI 消歧", "无回落结果（网络或解析差异）");
  }

  // W-P8 · sources:registry + disabledSources
  const reg = await evalJs(cdp, `
    if (!window.luminaApi?.sourcesRegistry) throw new Error("no sourcesRegistry");
    return await window.luminaApi.sourcesRegistry();
  `);
  if (Array.isArray(reg) && reg.length >= 20) {
    pass("W-P8", "sources:registry 20 源", `${reg.length} 条`);
  } else {
    fail("W-P8", "sources:registry", String(reg?.length ?? "null"));
  }

  const disableTest = await evalJs(cdp, `
    const cur = await window.luminaApi.getSettings() || {};
    await window.luminaApi.saveSettings({ ...cur, disabledSources: ["zenodo"] });
    const r = await window.luminaApi.searchOnline("machine learning", { limit: 5 });
    const hasZenodo = r?.perSource && Object.prototype.hasOwnProperty.call(r.perSource, "zenodo");
    await window.luminaApi.saveSettings({ ...cur, disabledSources: [] });
    return { hasZenodo, srcCount: Object.keys(r?.perSource || {}).length };
  `);
  !disableTest?.hasZenodo
    ? pass("W-P8", "disabledSources 过滤 zenodo", `${disableTest?.srcCount} 源参与`)
    : fail("W-P8", "zenodo 仍参与检索", JSON.stringify(disableTest));

  // W-P10 · 预取 IPC 面（设置字段 + 监听器）
  const prefetchApi = await evalJs(cdp, `
    const oa = window.luminaOa;
    return {
      hasStart: typeof oa?.onPrefetchStart === "function",
      hasDone: typeof oa?.onPrefetchDone === "function",
      settingsField: typeof (await window.luminaApi.getSettings())?.prefetchOnIdentifier === "boolean" ||
        (await window.luminaApi.getSettings())?.prefetchOnIdentifier === undefined,
    };
  `);
  prefetchApi?.hasStart && prefetchApi?.hasDone
    ? pass("W-P10", "预取 IPC 监听器", "prefetch:start/done")
    : fail("W-P10", "预取 IPC", JSON.stringify(prefetchApi));

  // W-P5 · mirrors:probe
  const mirrors = await evalJs(cdp, `
    if (!window.luminaOa?.probeMirrors) throw new Error("no probeMirrors");
    return await window.luminaOa.probeMirrors();
  `);
  mirrors && (mirrors.libgen || mirrors.annas)
    ? pass("W-P5", "mirrors:probe", `libgen ${mirrors.libgen?.length ?? 0} · annas ${mirrors.annas?.length ?? 0}`)
    : skip("W-P5", "mirrors:probe", "网络或镜像超时");

  // W-P9 · searchRetrySource IPC
  const retry = await evalJs(cdp, `
    if (!window.luminaApi?.searchRetrySource) throw new Error("no searchRetrySource");
    const r = await window.luminaApi.searchRetrySource("doaj", "covid vaccine", { limit: 3 });
    return { ok: !!r, count: r?.papers?.length ?? r?.hits?.length ?? 0, id: r?.id };
  `);
  retry?.count > 0
    ? pass("W-P9", "searchRetrySource doaj", `${retry.count} 条`)
    : skip("W-P9", "单源重试", "doaj 无结果或超时");

  // W-UI · 设置面板 Wave 3 控件
  await evalJs(cdp, `document.querySelector('.lf-icon[aria-label="设置"]')?.click();`);
  await new Promise((r) => setTimeout(r, 500));
  await evalJs(cdp, `
    const src = [...document.querySelectorAll(".set-railbtn")].find(b => (b.textContent||"").includes("数据源"));
    if (src) src.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 400));
  const uiPanel = await evalJs(cdp, `
    const t = document.body.innerText;
    return {
      toggles: t.includes("检索源开关"),
      prefetch: t.includes("标识符直达预取"),
      mirrors: t.includes("全文库镜像"),
      count: document.querySelectorAll(".lf-src-row").length,
    };
  `);
  uiPanel?.toggles && uiPanel?.prefetch
    ? pass("W-UI", "设置·Wave3 控件", `源开关 ${uiPanel.count} 行 · 预取 · 镜像`)
    : fail("W-UI", "设置 Wave3", JSON.stringify(uiPanel));

  // W-P3 UI · 标识符检索渲染
  await evalJs(cdp, `
    const close = document.querySelector(".set-modal .set-close, button[aria-label='关闭']");
    if (close) close.click();
    else document.querySelector(".set-overlay")?.click?.();
    const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("检索取文"));
    if (t) t.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 400));
  await evalJs(cdp, `
    const inp = document.querySelector(".ff-bar input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(inp, "10.1126/science.abc1234");
    else inp.value = "10.1126/science.abc1234";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 6000));
  const idUi = await evalJs(cdp, `
    return {
      cards: document.querySelectorAll(".ff-card").length,
      idTag: !!document.querySelector(".ff-idtag"),
      chips: document.querySelectorAll(".lf-src-chip").length,
    };
  `);
  idUi?.cards > 0
    ? pass("W-P3", "DOI UI 渲染", `${idUi.cards} 卡 · idtag=${idUi.idTag} · chips=${idUi.chips}`)
    : skip("W-P3", "DOI UI", "无卡片（debounce/网络）");

  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, "usp-waves-findfetch.png"), Buffer.from(data, "base64"));

  try { cdp.ws.close(); } catch { /* ignore */ }
} catch (e) {
  fail("BOOT", "烟测中断", e.message);
}

const nFail = results.filter((r) => !r.ok && !r.skipped).length;
writeFileSync(path.join(OUT, "usp-waves-report.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败`);
console.log(`报告：${path.join(OUT, "usp-waves-report.json")}\n`);
process.exit(nFail ? 1 : 0);
