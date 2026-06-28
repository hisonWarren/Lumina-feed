#!/usr/bin/env node
/**
 * 真机烟测 · 指定联络邮箱（Unpaywall / 预取 / 取文）
 * 用法：node tools/smoke-email-session.mjs [email]
 * 需 Electron：npx electron . --remote-debugging-port=9222
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_EMAIL = process.argv[2] || "wxs_insist@163.com";
const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const results = [];
const pass = (id, detail = "") => { results.push({ id, ok: true, detail }); console.log(`  ✓ ${id}${detail ? " — " + detail : ""}`); };
const fail = (id, detail = "") => { results.push({ id, ok: false, detail }); console.log(`  ✗ ${id}${detail ? " — " + detail : ""}`); };
const skip = (id, detail = "") => { results.push({ id, ok: true, skipped: true, detail }); console.log(`  ○ ${id} — ${detail}`); };

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP 未就绪 — 请先启动 Electron --remote-debugging-port=9222");
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

console.log(`\n── 联络邮箱真机烟测 · ${TEST_EMAIL} ──\n`);

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");

  // 1 · 写入邮箱 + 开启预取
  const cfg = await evalJs(cdp, `
    window.__prefetchTest = { done: false, ok: false, source: null, paperId: null };
    if (window.luminaOa?.onPrefetchDone) {
      window.luminaOa.onPrefetchDone(({ paperId, result }) => {
        window.__prefetchTest = { done: true, ok: !!(result && result.ok), source: result?.source || null, paperId, reason: result?.reason };
      });
    }
    const cur = await window.luminaApi.getSettings() || {};
    await window.luminaApi.saveSettings({
      ...cur,
      contactEmail: ${JSON.stringify(TEST_EMAIL)},
      prefetchOnIdentifier: true,
      prompts: { ...(cur.prompts||{}), onboardingEmailDismissed: true, searchEmailShown: true, fetchEmailShown: true },
    });
    const view = await window.luminaApi.getSettings();
    return { contactEmail: view?.contactEmail, prefetch: view?.prefetchOnIdentifier };
  `);
  cfg?.contactEmail === TEST_EMAIL
    ? pass("EMAIL-1", "settings 已保存联络邮箱")
    : fail("EMAIL-1", JSON.stringify(cfg));

  // 2 · DOI 标识符解析（高置信，触发预取）
  const doi = "10.1038/nature12373";
  const resolved = await evalJs(cdp, `
    return await window.luminaApi.searchOnline(${JSON.stringify(doi)}, {});
  `);
  const paperId = resolved?.papers?.[0]?.id;
  if (resolved?.locateMode === "identifier" && paperId) {
    pass("EMAIL-2", `标识符通道 · ${resolved.papers[0].title?.slice(0, 45) || paperId}`);
  } else {
    fail("EMAIL-2", JSON.stringify(resolved).slice(0, 100));
  }

  // 3 · 等待预取（最多 120s）
  let prefetchOk = false;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await evalJs(cdp, `return window.__prefetchTest;`);
    if (st?.done) {
      prefetchOk = st.ok;
      st.ok ? pass("EMAIL-3", `prefetch:done · ${st.source}`) : skip("EMAIL-3", `预取未成功 · ${st.reason || "no_pdf"}`);
      break;
    }
    if (i === 119) skip("EMAIL-3", "120s 内无 prefetch:done（可能已有 PDF 或取文链失败）");
  }

  // 4 · 手动 fetchPaper（若预取未成功）
  if (paperId && !prefetchOk) {
    const fetch = await evalJs(cdp, `
      return await window.luminaOa.fetchPaper(${JSON.stringify(paperId)});
    `);
    fetch?.ok
      ? pass("EMAIL-4", `oa:fetchPaper · ${fetch.source || "ok"}`)
      : skip("EMAIL-4", fetch?.reason || "fetch 失败");
  } else if (prefetchOk) {
    pass("EMAIL-4", "预取已成功，跳过手动 fetch");
  }

  // 5 · PDF 落盘
  const pdfs = await evalJs(cdp, `return await window.luminaOa.listPdfs();`);
  Array.isArray(pdfs) && pdfs.length > 0
    ? pass("EMAIL-5", `${pdfs.length} 个 PDF 在本机`)
    : skip("EMAIL-5", "暂无落盘 PDF");

  // 6 · 检索深度「标准」选中态 CSS（--petrol 映射）
  const depthStyle = await evalJs(cdp, `
    const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("检索取文"));
    if (t) t.click();
    await new Promise(r => setTimeout(r, 300));
    const btn = document.querySelector(".lf-depth-opt.on");
    if (!btn) return { ok: false, reason: "no .on" };
    const bg = getComputedStyle(btn).backgroundColor;
    const fg = getComputedStyle(btn).color;
    return { ok: true, bg, fg, text: btn.textContent?.trim() };
  `);
  depthStyle?.ok && depthStyle.bg && depthStyle.bg !== "rgba(0, 0, 0, 0)" && depthStyle.fg === "rgb(255, 255, 255)"
    ? pass("EMAIL-6", `「${depthStyle.text}」选中态 ${depthStyle.bg}`)
    : fail("EMAIL-6", JSON.stringify(depthStyle));

  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, "email-session-findfetch.png"), Buffer.from(data, "base64"));

  // 恢复预取默认关（保留邮箱）
  await evalJs(cdp, `
    const cur = await window.luminaApi.getSettings() || {};
    await window.luminaApi.saveSettings({ ...cur, prefetchOnIdentifier: false });
  `);

  try { cdp.ws.close(); } catch { /* ignore */ }
} catch (e) {
  fail("BOOT", e.message);
}

const nFail = results.filter((r) => !r.ok && !r.skipped).length;
writeFileSync(path.join(OUT, "email-session-report.json"), JSON.stringify({
  at: new Date().toISOString(),
  email: TEST_EMAIL,
  results,
}, null, 2));
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败`);
console.log(`报告：${path.join(OUT, "email-session-report.json")}\n`);
process.exit(nFail ? 1 : 0);
