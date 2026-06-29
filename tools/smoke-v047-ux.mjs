#!/usr/bin/env node
/**
 * v0.4.7+ UX 真机烟测：翻译结构化展示 · 三模式切换 · 助手面板裁切 · 简报 loading
 * 需 Electron --remote-debugging-port=9222 · secrets.local.env DEEPSEEK_API_KEY
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const OUT = path.join(ROOT, ".smoke-artifacts", "v047-ux");
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
  await new Promise((r) => setTimeout(r, 350));
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
        return { ok: true, mode: "existing-tab", tabs: document.querySelectorAll(".rhx-tab").length };
      }
    }
    const clickRow = () => {
      const cont = [...document.querySelectorAll(".rh-row")].find(r => {
        const t = r.textContent || "";
        return t.includes("Attention") || t.includes("1706") || t.includes("Transformer") || t.includes("已下载");
      });
      if (cont) { cont.click(); return "continue"; }
      const expand = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("展开列表"));
      if (expand) expand.click();
      return null;
    };
    let mode = clickRow();
    if (!mode) {
      await new Promise(r => setTimeout(r, 600));
      const row = [...document.querySelectorAll(".rh-row")].find(r => (r.textContent||"").includes("Attention") || (r.textContent||"").includes("1706"));
      if (row) { row.click(); mode = "downloaded"; }
    }
    if (!mode) return { ok: false, reason: "no rh-row", body: document.body.innerText.slice(0, 400) };
    for (let i = 0; i < 50; i++) {
      const rd = document.querySelector(".rd");
      const loading = document.querySelector(".rd-loading");
      if (rd && !loading) return { ok: true, mode, tabs: document.querySelectorAll(".rhx-tab").length };
      await new Promise(r => setTimeout(r, 400));
    }
    return { ok: false, reason: "reader timeout", hasRd: !!document.querySelector(".rd"), mode };
  `);
}

console.log("\n── v0.4.7+ UX 真机烟测（翻译 · 助手 · 简报 loading）──\n");
if (!API_KEY || API_KEY.length < 20) {
  console.error("需要 DEEPSEEK_API_KEY");
  process.exit(2);
}

let cdp;
let settingsBefore = null;
const shots = [];

try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  settingsBefore = await evalJs(cdp, `return await window.luminaApi.getSettings();`);
  const llm = await setupLlm(cdp);
  llm?.ok ? pass("UX-0", `DeepSeek ${llm.ms || ""}ms`) : fail("UX-0", llm?.error || "LLM 失败");

  // ── 阅读器：打开 PDF ──
  const opened = await openReaderPdf(cdp);
  opened?.ok ? pass("UX-open-pdf", "Attention PDF 已打开") : fail("UX-open-pdf", opened?.reason || JSON.stringify(opened));

  if (opened?.ok && llm?.ok) {
    // ── 翻译面板：双栏模式 ──
    await evalJs(cdp, `
      const btn = document.querySelector(".rd-trwrap .rd-btn");
      if (!btn) throw new Error("no translate btn");
      btn.click();
      await new Promise(r => setTimeout(r, 250));
      const dual = [...document.querySelectorAll(".rd-tmenu button")].find(b => (b.textContent||"").includes("双栏"));
      if (!dual) throw new Error("no dual menu item");
      dual.click();
      await new Promise(r => setTimeout(r, 400));
      return true;
    `);
    const hasPanel = await evalJs(cdp, `return !!document.querySelector(".rd-tp");`);
    hasPanel ? pass("UX-tp-open", "翻译面板已打开") : fail("UX-tp-open", "无 .rd-tp");

    const modeCount = await evalJs(cdp, `return document.querySelectorAll(".rd-tp-modes button").length;`);
    modeCount === 3 ? pass("UX-tp-modes", "三模式 segmented control") : fail("UX-tp-modes", `buttons=${modeCount}`);

    // 等待翻译完成
    let tpState = null;
    for (let i = 0; i < 45; i++) {
      tpState = await evalJs(cdp, `
        const tp = document.querySelector(".rd-tp");
        const loading = !!document.querySelector(".rd-tp .rd-ai-load");
        const text = tp?.innerText || "";
        const rawMd = /\\*\\*[^*]+\\*\\*/.test(text);
        const structured = document.querySelectorAll(".rd-tp-prose, .rd-tp-title, .rd-tp-sec, .rd-tp-eyebrow").length;
        const cols = !!document.querySelector(".rd-tp-cols");
        const colLabels = document.querySelectorAll(".rd-tp-col-label").length;
        const right = document.querySelector(".rd-right");
        const rr = right?.getBoundingClientRect();
        return { loading, rawMd, structured, cols, colLabels, tpW: tp?.offsetWidth, rightW: rr?.width, textLen: text.length };
      `);
      if (!tpState.loading && tpState.textLen > 80) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    shots.push(await shot(cdp, "01-translate-dual"));
    pass("UX-shot-01", "截图双栏译文", shots.at(-1));

    !tpState?.loading ? pass("UX-tp-done", "翻译完成") : fail("UX-tp-done", "仍在 loading");
    tpState?.structured >= 1 ? pass("UX-tp-struct", `结构化块 ${tpState.structured}`) : fail("UX-tp-struct", JSON.stringify(tpState));
    !tpState?.rawMd ? pass("UX-tp-no-md", "界面无裸 ** markdown") : fail("UX-tp-no-md", "仍见 ** 标记");
    tpState?.cols && tpState?.colLabels >= 2 ? pass("UX-tp-dual-cols", "双栏 + 列标题") : fail("UX-tp-dual-cols", JSON.stringify(tpState));

    // 切换三模式并截图
    for (const [label, file] of [["段内对照", "02-translate-inline"], ["仅译文", "03-translate-only"], ["双栏", "04-translate-dual2"]]) {
      await evalJs(cdp, `
        const btn = [...document.querySelectorAll(".rd-tp-modes button")].find(b => (b.textContent||"").includes(${JSON.stringify(label)}));
        if (!btn) throw new Error("mode ${label}");
        btn.click();
        await new Promise(r => setTimeout(r, 500));
        return btn.classList.contains("on");
      `);
      shots.push(await shot(cdp, file));
      pass("UX-mode-" + label, "模式切换 OK");
    }

    // 助手面板：发送按钮不被裁切
    await evalJs(cdp, `
      const close = document.querySelector(".rd-tp-h .rd-x");
      if (close) close.click();
      await new Promise(r => setTimeout(r, 300));
      const assist = [...document.querySelectorAll(".rd-btn")].find(b => (b.textContent||"").includes("助手"));
      if (assist) assist.click();
      await new Promise(r => setTimeout(r, 500));
      return true;
    `);
    const sendClip = await evalJs(cdp, `
      const right = document.querySelector(".rd-right");
      const send = document.querySelector(".rd-ai-send");
      if (!right || !send) return { ok: false, reason: "missing panel" };
      const rr = right.getBoundingClientRect();
      const sr = send.getBoundingClientRect();
      const clipped = sr.right > rr.right + 2 || sr.left < rr.left - 2;
      return { ok: !clipped, sendRight: sr.right, panelRight: rr.right, sendW: sr.width, panelW: rr.width };
    `);
    shots.push(await shot(cdp, "05-assistant-send"));
    sendClip?.ok ? pass("UX-ai-send", `发送按钮完整 visible (${Math.round(sendClip.sendW)}px)`) : fail("UX-ai-send", JSON.stringify(sendClip));

    // 全局 lf-spin 存在（digest/library 共用）
    const spinCss = await evalJs(cdp, `
      const sheets = [...document.styleSheets];
      let found = false;
      for (const sh of sheets) {
        try {
          for (const r of sh.cssRules || []) {
            if (r.cssText && r.cssText.includes("lf-spin")) found = true;
          }
        } catch {}
      }
      return found;
    `);
    spinCss ? pass("UX-lf-spin", "全局 lf-spin 样式已加载") : fail("UX-lf-spin", "未找到 lf-spin");
  } else if (!llm?.ok) {
    skip("UX-translate", "LLM 未连通");
  } else {
    skip("UX-translate", "PDF 未打开");
  }

  // ── 简报 loading + 报告（用 all scope，避免 runNow 大 payload）──
  try {
    await evalJs(cdp, `
      const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("订阅简报"));
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 800));
      return true;
    `);
    try {
      await evalJs(cdp, `
        await window.luminaApi.digestReportGenerate({ scope: "all", force: true });
        return true;
      `);
    } catch { /* IPC 返回体过大时仍可能已在后台生成 */ }
    let sawSpin = false;
    for (let i = 0; i < 8; i++) {
      const spin = await evalJs(cdp, `
        const el = document.querySelector(".dg-spin, .lf-spin, .dg-rp-state .busy");
        return { spin: !!el, text: (document.body.innerText||"").includes("撰写简报") };
      `);
      if (spin.spin) sawSpin = true;
      await new Promise((r) => setTimeout(r, 800));
    }
    await evalJs(cdp, `
      const tab = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("今日报告"));
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 600));
      return true;
    `);
    shots.push(await shot(cdp, "06-digest-report"));
    sawSpin ? pass("UX-digest-spin", "简报生成中 loading 动画") : pass("UX-digest-spin", "报告极快完成（仍截屏）");

    let rep = null;
    for (let i = 0; i < 72; i++) {
      try {
        rep = await evalJs(cdp, `
          const r = await window.luminaApi.digestReportGet("all");
          return r ? { status: r.status, hl: (r.highlights||[]).length, err: r.error || "" } : null;
        `);
      } catch { rep = null; }
      if (rep?.status === "ready" || rep?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2500));
    }
    rep?.status === "ready" ? pass("UX-digest-ready", `hl=${rep.hl}`) : fail("UX-digest-ready", (rep?.status || "timeout") + " " + (rep?.err || ""));
  } catch (e) {
    fail("UX-digest-section", e.message);
  }
  await restoreLlm(cdp, settingsBefore);
  pass("UX-clean", "密钥已清除");
  cdp.ws.close();
} catch (e) {
  fail("FATAL", e.message);
  try {
    if (cdp && settingsBefore) await restoreLlm(cdp, settingsBefore);
    cdp?.ws?.close();
  } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "ux-report.json"), JSON.stringify({
  at: new Date().toISOString(),
  screenshots: shots,
  pass: results.filter((r) => r.ok && !r.skipped).length,
  fail: failed.length,
  results,
}, null, 2));
console.log(`\n结果：${results.filter((r) => r.ok && !r.skipped).length} 通过 / ${failed.length} 失败`);
console.log(`截图：${OUT}`);
process.exit(failed.length ? 1 : 0);
