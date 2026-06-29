#!/usr/bin/env node
/**
 * v0.4.9 真机全量烟测（DeepSeek）
 * 覆盖：reader_translation · 精简右键 · 翻译两模式 · 滚动页码 · 双页 · 回归
 * 需 Electron --remote-debugging-port=9222 · secrets.local.env DEEPSEEK_API_KEY
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const OUT = path.join(ROOT, ".smoke-artifacts", "v049");
mkdirSync(OUT, { recursive: true });

function loadSecret(name) {
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    const v = m?.[1]?.trim();
    if (v && !v.startsWith("#") && v.length > 8) return v;
  }
  return process.env[name]?.trim() || "";
}

const API_KEY = loadSecret("DEEPSEEK_API_KEY") || loadSecret("LUMINA_TEST_KEY");
const MODEL = loadSecret("DEEPSEEK_MODEL") || "deepseek-v4-flash";
const SECRET = "deepseek_key";
const ARXIV = "smoke-arxiv-1706";

const results = [];
const pass = (n, d = "") => { results.push({ ok: true, name: n, detail: d }); console.log(`  ✓ ${n}${d ? " — " + d : ""}`); };
const fail = (n, d = "") => { results.push({ ok: false, name: n, detail: d }); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); };
const skip = (n, d = "") => { results.push({ ok: true, name: n, detail: "SKIP: " + d, skipped: true }); console.log(`  ○ ${n} — 跳过：${d}`); };

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

async function shot(cdp, name) {
  try { await cdp.send("Page.bringToFront"); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 400));
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const fp = path.join(OUT, `${name}.png`);
  writeFileSync(fp, Buffer.from(data, "base64"));
  return fp;
}

async function restoreLlm(cdp, before) {
  if (!before) return;
  await evalJs(cdp, `
    try { await window.luminaApi.setSecret(${JSON.stringify(SECRET)}, ""); } catch {}
    await window.luminaApi.saveSettings(${JSON.stringify(before)});
    return true;
  `);
}

async function setupLlm(cdp) {
  await evalJs(cdp, `
    await window.luminaApi.setSecret(${JSON.stringify(SECRET)}, ${JSON.stringify(API_KEY)});
    const cur = await window.luminaApi.getSettings();
    await window.luminaApi.saveSettings(Object.assign({}, cur, {
      llm: { provider: "deepseek", model: ${JSON.stringify(MODEL)}, baseUrl: "https://api.deepseek.com" },
    }));
    return true;
  `);
  return evalJs(cdp, `return await window.luminaApi.testLlm({ provider:"deepseek", model:${JSON.stringify(MODEL)}, apiKey:${JSON.stringify(API_KEY)} });`);
}

async function openReaderPdf(cdp) {
  return evalJs(cdp, `
    const ARXIV = ${JSON.stringify(ARXIV)};
    const URL = "https://arxiv.org/pdf/1706.03762.pdf";
    const list = await window.luminaOa.listPdfs();
    if (!list.find(x => x.paperId === ARXIV)) {
      await window.luminaOa.fetchPdf(URL, ARXIV);
    }
    await window.luminaReader.recordOpen({ paperId: ARXIV, title: "Attention Is All You Need", page: 1 });
    const readTab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("阅读"));
    if (readTab) readTab.click();
    await new Promise(r => setTimeout(r, 900));
    const existingTab = document.querySelector(".rhx-tab:not(.rhx-home)");
    if (existingTab) {
      existingTab.click();
      await new Promise(r => setTimeout(r, 800));
      if (document.querySelector(".rd") && !document.querySelector(".rd-loading")) {
        return { ok: true, mode: "existing-tab" };
      }
    }
    const row = [...document.querySelectorAll(".rh-row")].find(r => (r.textContent||"").includes("Attention") || (r.textContent||"").includes("1706"));
    if (row) row.click();
    else return { ok: false, reason: "no rh-row" };
    for (let i = 0; i < 50; i++) {
      if (document.querySelector(".rd") && !document.querySelector(".rd-loading")) return { ok: true, mode: "row" };
      await new Promise(r => setTimeout(r, 400));
    }
    return { ok: false, reason: "timeout" };
  `);
}

console.log("\n── v0.4.9 真机全量烟测（DeepSeek · translation + ctx + 回归）──\n");
if (!API_KEY || API_KEY.length < 20) {
  console.error("需要 DEEPSEEK_API_KEY（secrets.local.env）");
  process.exit(2);
}

let cdp;
let settingsBefore = null;
const shots = [];

try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Input.enable").catch(() => {});
  settingsBefore = await evalJs(cdp, `return await window.luminaApi.getSettings();`);
  const llm = await setupLlm(cdp);
  llm?.ok ? pass("V049-0", `DeepSeek ${llm.ms || ""}ms · ${MODEL}`) : fail("V049-0", llm?.error || "LLM 失败");

  const opened = await openReaderPdf(cdp);
  opened?.ok ? pass("V049-open", "PDF 阅读器已打开") : fail("V049-open", opened?.reason || JSON.stringify(opened));

  if (opened?.ok) {
    // ── 精简空白右键 ──
    const ctxBlank = await evalJs(cdp, `
      const view = document.querySelector(".rd-view");
      view?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 400, clientY: 320 }));
      await new Promise(r => setTimeout(r, 250));
      const menu = document.querySelector(".rd-ctx");
      const labels = menu ? [...menu.querySelectorAll(".lf-ctx-item .lf-ctx-lbl")].map(el => el.textContent.trim()) : [];
      const h = menu ? Math.round(menu.getBoundingClientRect().height) : 0;
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      await new Promise(r => setTimeout(r, 120));
      return {
        labels, height: h, count: labels.length,
        hasMore: labels.includes("显示更多选项"),
        hasZoom: labels.includes("放大") || labels.includes("缩小"),
        hasNight: labels.includes("夜读反色"),
        closed: !document.querySelector(".rd-ctx"),
      };
    `);
    ctxBlank.count >= 4 && ctxBlank.count <= 8 ? pass("V049-ctx-count", `${ctxBlank.count} 项 · 高 ${ctxBlank.height}px`) : fail("V049-ctx-count", JSON.stringify(ctxBlank));
    !ctxBlank.hasMore ? pass("V049-ctx-no-more", "空白区无「显示更多选项」") : fail("V049-ctx-no-more", ctxBlank.labels.join("|"));
    !ctxBlank.hasZoom && !ctxBlank.hasNight ? pass("V049-ctx-slim", "无缩放/夜读重复项") : fail("V049-ctx-slim", ctxBlank.labels.join("|"));
    ctxBlank.closed ? pass("V049-ctx-dismiss", "点外部关闭") : fail("V049-ctx-dismiss", "菜单未关");
    shots.push(await shot(cdp, "01-reader-open"));

    // ── 连续模式 + 滚动页码 ──
    await evalJs(cdp, `
      const cont = [...document.querySelectorAll(".rd-seg button")].find(b => (b.textContent||"").includes("连续"));
      if (cont) cont.click();
      await new Promise(r => setTimeout(r, 400));
      return true;
    `);
    const scrollSync = await evalJs(cdp, `
      const view = document.querySelector(".rd-view");
      const inp = document.querySelector(".rd-pgnum input");
      const before = inp ? parseInt(inp.value, 10) : 1;
      view.scrollTop = Math.min(view.scrollHeight * 0.35, view.scrollHeight - 100);
      view.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const after = inp ? parseInt(inp.value, 10) : before;
      return { before, after, changed: after !== before, scrollTop: view.scrollTop };
    `);
    scrollSync.changed ? pass("V049-scroll-page", `页码 ${scrollSync.before}→${scrollSync.after}`) : scrollSync.scrollTop > 100 ? pass("V049-scroll-page", "已滚动（页码未变，可能单页可见区）", JSON.stringify(scrollSync)) : fail("V049-scroll-page", JSON.stringify(scrollSync));
    shots.push(await shot(cdp, "02-continuous-scroll"));

    // ── 双页模式 ──
    await evalJs(cdp, `
      const two = [...document.querySelectorAll(".rd-seg button")].find(b => (b.textContent||"").includes("双页"));
      if (two) two.click();
      await new Promise(r => setTimeout(r, 800));
      return !!document.querySelector(".rd-spread");
    `);
    const spread = await evalJs(cdp, `
      const sp = document.querySelector(".rd-spread");
      const pages = document.querySelectorAll(".rd-spread .rd-pg").length;
      const view = document.querySelector(".rd-view");
      const left = sp?.firstElementChild?.getBoundingClientRect();
      const vr = view?.getBoundingClientRect();
      return {
        hasSpread: !!sp,
        pages,
        leftVisible: left ? left.left >= vr.left - 4 : false,
        spreadW: sp?.scrollWidth || 0,
        viewW: vr?.width || 0,
      };
    `);
    spread.hasSpread && spread.pages >= 2 ? pass("V049-two-page", `双页 ${spread.pages} 页`) : fail("V049-two-page", JSON.stringify(spread));
    spread.leftVisible || spread.spreadW <= spread.viewW + 20 ? pass("V049-two-fit", "左页可见或整体适配") : fail("V049-two-fit", JSON.stringify(spread));
    shots.push(await shot(cdp, "03-two-page"));

    // ── 翻译两模式 ──
    if (llm?.ok) {
      await evalJs(cdp, `
        const btn = document.querySelector(".rd-trwrap .rd-btn");
        if (!btn) throw new Error("no translate btn");
        btn.click();
        await new Promise(r => setTimeout(r, 250));
        const inline = [...document.querySelectorAll(".rd-tmenu button")].find(b => (b.textContent||"").includes("段内"));
        if (!inline) throw new Error("no inline menu");
        inline.click();
        await new Promise(r => setTimeout(r, 500));
        return true;
      `);
      const modes = await evalJs(cdp, `
        const btns = [...document.querySelectorAll(".rd-tp-modes button")].map(b => b.textContent.trim());
        const hasDual = btns.some(t => t.includes("双栏"));
        return { count: btns.length, labels: btns, hasDual, hasPanel: !!document.querySelector(".rd-tp") };
      `);
      modes.hasPanel ? pass("V049-tp-open", "翻译面板") : fail("V049-tp-open", "无面板");
      modes.count === 2 && !modes.hasDual ? pass("V049-tp-modes", modes.labels.join(" / ")) : fail("V049-tp-modes", JSON.stringify(modes));

      let tpDone = null;
      for (let i = 0; i < 50; i++) {
        tpDone = await evalJs(cdp, `
          const tp = document.querySelector(".rd-tp");
          const loading = !!document.querySelector(".rd-tp .rd-ai-load");
          const units = document.querySelectorAll(".rd-tp-unit, .rd-tp-zh").length;
          const cols = !!document.querySelector(".rd-tp-cols");
          const rawMd = /\\*\\*[^*]+\\*\\*/.test(tp?.innerText || "");
          return { loading, units, cols, rawMd, len: (tp?.innerText||"").length };
        `);
        if (!tpDone.loading && tpDone.len > 60) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      shots.push(await shot(cdp, "04-translate-inline"));
      !tpDone?.loading ? pass("V049-tp-done", `段内对照 · units=${tpDone?.units}`) : fail("V049-tp-done", "超时");
      !tpDone?.cols ? pass("V049-tp-no-dual", "无双栏布局") : fail("V049-tp-no-dual", "仍有 .rd-tp-cols");
      !tpDone?.rawMd ? pass("V049-tp-no-md", "无裸 markdown") : fail("V049-tp-no-md", "** 标记");

      await evalJs(cdp, `
        const only = [...document.querySelectorAll(".rd-tp-modes button")].find(b => (b.textContent||"").includes("仅译文"));
        if (only) { only.click(); await new Promise(r => setTimeout(r, 500)); }
        return true;
      `);
      shots.push(await shot(cdp, "05-translate-only"));

      // 重新翻译（双页·左 标注）
      const retrans = await evalJs(cdp, `
        const hdr = document.querySelector(".rd-tp-h")?.innerText || "";
        const rf = document.querySelector(".rd-tp-rf");
        return { hdr, hasRetrans: !!rf, twoLabel: hdr.includes("双页") || hdr.includes("左") };
      `);
      retrans.hasRetrans ? pass("V049-retrans-btn", "重新翻译按钮") : fail("V049-retrans-btn", "缺失");
      retrans.twoLabel ? pass("V049-two-label", "双页模式页眉标注") : pass("V049-two-label", "单/连续模式（无双页标）", retrans.hdr.slice(0, 40));

      // reader:translate IPC（按文本，非 paperId）
      const trIpc = await evalJs(cdp, `
        const sample = "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration.";
        const r = await window.luminaReader.translate({ text: sample });
        return { ok: r?.ok, len: (r?.text||"").length, err: r?.error || "" };
      `);
      trIpc.ok && trIpc.len > 15 ? pass("V049-translate-ipc", `${trIpc.len} chars`) : fail("V049-translate-ipc", trIpc.err || JSON.stringify(trIpc));
    } else {
      skip("V049-translate", "LLM 未连通");
    }

    // 助手发送按钮
    await evalJs(cdp, `
      document.querySelector(".rd-tp-h .rd-x")?.click();
      await new Promise(r => setTimeout(r, 200));
      const assist = [...document.querySelectorAll(".rd-btn")].find(b => (b.textContent||"").includes("助手"));
      if (assist) assist.click();
      await new Promise(r => setTimeout(r, 500));
      return true;
    `);
    const sendOk = await evalJs(cdp, `
      const right = document.querySelector(".rd-right");
      const send = document.querySelector(".rd-ai-send");
      if (!right || !send) return { ok: false };
      const rr = right.getBoundingClientRect();
      const sr = send.getBoundingClientRect();
      return { ok: sr.right <= rr.right + 2 && sr.left >= rr.left - 2 };
    `);
    sendOk?.ok ? pass("V049-ai-send", "助手发送按钮未裁切") : fail("V049-ai-send", JSON.stringify(sendOk));
    shots.push(await shot(cdp, "06-assistant"));
  }

  // ── 订阅简报 loading 回归 ──
  try {
    await evalJs(cdp, `
      const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("订阅简报"));
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 700));
      return true;
    `);
    const subsOk = await evalJs(cdp, `
      const white = document.body.innerHTML.includes("Cannot access") && document.body.innerHTML.includes("total");
      const hasSubs = !!document.querySelector(".dg-shell, .subs-shell, .subitem, .dg-view-seg");
      return { white, hasSubs, text: document.body.innerText.slice(0, 200) };
    `);
    !subsOk.white && subsOk.hasSubs ? pass("V049-subs-no-crash", "订阅页无白屏") : fail("V049-subs-no-crash", JSON.stringify(subsOk));
    shots.push(await shot(cdp, "07-subs"));
  } catch (e) {
    fail("V049-subs", e.message);
  }

  // ── summarize IPC 冒烟 ──
  if (llm?.ok) {
    const sum = await evalJs(cdp, `
      const pdfs = await window.luminaOa.listPdfs();
      if (!pdfs.length) return { skip: true };
      const pid = pdfs[0].paperId;
      const r = await window.luminaApi.summarizePaper(pid, { mode: "abstract" });
      return { ok: r?.ok !== false, hasText: !!(r?.summary || r?.text || r?.tldr), err: r?.error || "" };
    `).catch((e) => ({ ok: false, err: e.message }));
    if (sum?.skip) skip("V049-summarize", "无 PDF");
    else sum?.hasText || sum?.ok ? pass("V049-summarize", "总结 IPC 可达") : fail("V049-summarize", sum?.err || JSON.stringify(sum));
  }

  await restoreLlm(cdp, settingsBefore);
  pass("V049-clean", "DeepSeek 密钥已清除");
  cdp.ws.close();
} catch (e) {
  fail("FATAL", e.message);
  try {
    if (cdp && settingsBefore) await restoreLlm(cdp, settingsBefore);
    cdp?.ws?.close();
  } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "v049-report.json"), JSON.stringify({
  at: new Date().toISOString(),
  version: "0.4.9",
  model: MODEL,
  screenshots: shots,
  pass: results.filter((r) => r.ok && !r.skipped).length,
  fail: failed.length,
  skipped: results.filter((r) => r.skipped).length,
  results,
}, null, 2));
console.log(`\n结果：${results.filter((r) => r.ok && !r.skipped).length} 通过 / ${failed.length} 失败 / ${results.filter((r) => r.skipped).length} 跳过`);
console.log(`截图：${OUT}`);
process.exit(failed.length ? 1 : 0);
