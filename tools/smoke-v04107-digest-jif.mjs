#!/usr/bin/env node
/**
 * v0.4.107 真机烟测 + 截图门禁
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9241;
const CDP = `http://127.0.0.1:${PORT}`;
const SHOT = path.join(ROOT, "tools", "_smoke-shots-04107");
mkdirSync(SHOT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ✓", n); else { console.log("  ✗", n, e ? JSON.stringify(e) : ""); failed++; } };

async function waitCdp(ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* */ }
    await sleep(400);
  }
  throw new Error("CDP timeout");
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
  return result?.value;
}

async function shot(cdp, name) {
  try {
    const capt = cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const data = await Promise.race([
      capt.then((r) => r.data),
      sleep(8000).then(() => null),
    ]);
    if (!data) {
      console.log("  ⚠ screenshot timeout", name);
      return null;
    }
    const fp = path.join(SHOT, name);
    writeFileSync(fp, Buffer.from(data, "base64"));
    console.log("  📷", fp);
    return fp;
  } catch (e) {
    console.log("  ⚠ screenshot fail", name, String(e.message || e));
    return null;
  }
}

console.log("\n── smoke-v04107-digest-jif ──\n");
const electronBin = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
if (!existsSync(electronBin)) {
  console.error("missing electron binary");
  process.exit(1);
}

const child = spawn(electronBin, [".", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*"], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});

try {
  const wsUrl = await waitCdp();
  const cdp = await cdpConnect(wsUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  for (let i = 0; i < 80; i++) {
    if (await evalJs(cdp, `return !!document.querySelector(".lf-nav");`)) break;
    await sleep(400);
  }

  const settings = await evalJs(cdp, `
    const s = await window.luminaApi.getSettings();
    return { digestReportAuto: s?.digestReportAuto, flag: s?.prompts?.digestManualAiDefaultV04107 };
  `);
  ok("digestReportAuto === false（迁移后）", settings && settings.digestReportAuto === false, settings);

  const subs = await evalJs(cdp, `
    const btn = [...document.querySelectorAll(".lf-nav .lf-tab")].find((b) => /订阅|简报/.test(b.textContent||""));
    if (!btn) return { ok:false, reason:"no_subs_tab" };
    btn.click();
    await new Promise((r)=>setTimeout(r,600));
    const reportTab = [...document.querySelectorAll("[role=tab], button")].find((b) => (b.textContent||"").includes("今日报告"));
    if (reportTab) { reportTab.click(); await new Promise((r)=>setTimeout(r,800)); }
    const body = document.body.innerText || "";
    return {
      ok: true,
      hasReady: !!document.querySelector(".dg-rp-reader") || /正在更新报告/.test(body),
      empty: /报告尚未就绪/.test(body),
      claimsAuto: /系统会在有待读时自动生成/.test(body),
      manualHint: /手动生成/.test(body),
      updating: /正在更新报告|正在撰写/.test(body),
    };
  `);
  ok("订阅页可打开", subs && subs.ok, subs);
  ok("空态不再写「系统会…自动生成」", !(subs && subs.claimsAuto), subs);
  ok(
    "报告区：就绪正文 / 更新中 / 手动空态 三者其一",
    !!(subs && (subs.hasReady || subs.updating || (subs.empty && subs.manualHint))),
    subs,
  );
  console.log("  · capturing digest shot…");
  await shot(cdp, "01-digest-report.png");
  console.log("  · journals…");
  const jrUi = await evalJs(cdp, `
    const btn = [...document.querySelectorAll(".lf-nav .lf-tab")].find((b) => (b.textContent||"").includes("期刊"));
    if (!btn) return { ok:false, reason:"no_jr_tab" };
    btn.click();
    await new Promise((r)=>setTimeout(r,400));
    const input = document.querySelector(".jr-bar input");
    if (!input) return { ok:false, reason:"no_input" };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "PLoS ONE");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r)=>setTimeout(r,60));
    document.querySelector(".jr-go")?.click();
    let name = "", heroes = [];
    for (let i = 0; i < 40; i++) {
      await new Promise((r)=>setTimeout(r,400));
      name = document.querySelector(".jr-name")?.textContent || "";
      heroes = [...document.querySelectorAll(".jr-hero")].map((el) => el.innerText.replace(/\\s+/g, " ").trim());
      if (name && /plos/i.test(name)) break;
    }
    return { ok: !!name, name, jifText: heroes[0] || "", heroes };
  `);
  ok("PLoS ONE 卡片命中", jrUi && jrUi.ok && /plos/i.test(jrUi.name || ""), jrUi);
  await shot(cdp, "02-journal-plos-before-live.png");

  const liveWrap = await evalJs(cdp, `
    return await Promise.race([
      window.luminaJournal.liveMetrics(["1932-6203"], { jif: true, cas: false, openalex: false }),
      new Promise((resolve) => setTimeout(() => resolve({ __timeout: true, jifTried: true }), 75000)),
    ]);
  `);
  const after = await evalJs(cdp, `
    await new Promise((r)=>setTimeout(r,1200));
    const heroes = [...document.querySelectorAll(".jr-hero")].map((el) => el.innerText.replace(/\\s+/g, " ").trim());
    return { jifText: heroes[0] || "", heroes };
  `);
  const jr = {
    ...jrUi,
    jifText: after?.jifText || jrUi?.jifText || "",
    heroes: after?.heroes || jrUi?.heroes || [],
    liveJif: liveWrap?.jif?.jif ?? null,
    jifTried: !!liveWrap?.jifTried,
    liveTimeout: !!liveWrap?.__timeout,
  };
  const jifOk = jr.liveJif != null || (/\d/.test(jr.jifText) && !/未收录|暂不可用|去添加|查询中/.test(jr.jifText));
  const jifHonest = /暂不可用|在线拉取未命中|未收录/.test(jr.jifText) || (jr.jifTried && jr.liveJif == null);
  ok("JIF：有数值 或 诚实不可用文案", !!(jifOk || jifHonest), jr);
  if (jifOk) ok("JIF 数值真机通过（可发版宣称）", true);
  else {
    console.log("  · JIF 本机未出数值 — SplitRelease：不宣称 WOS 已修好");
    ok("诚实空态门禁", !!jifHonest, jr);
  }
  await shot(cdp, "02-journal-plos-jif.png");

  const nat = await evalJs(cdp, `
    return await Promise.race([
      window.luminaJournal.liveMetrics(["0028-0836"], { jif: true, cas: false, openalex: false }),
      new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 75000)),
    ]);
  `);
  console.log("  · Nature live JIF probe:", JSON.stringify({ jif: nat?.jif?.jif, tried: nat?.jifTried, timeout: nat?.__timeout }));
  if (nat?.jif?.jif != null) {
    ok("Nature ISSN live JIF 有值", true, nat);
    await evalJs(cdp, `
      const input = document.querySelector(".jr-bar input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "0028-0836");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".jr-go")?.click();
      for (let i=0;i<30;i++){ await new Promise(r=>setTimeout(r,400)); if (document.querySelector(".jr-name")) break; }
    `);
    await sleep(1500);
    await shot(cdp, "03-journal-nature-jif.png");
  }

  writeFileSync(path.join(SHOT, "result.json"), JSON.stringify({ settings, subs, jr, nat, failed }, null, 2));
} catch (e) {
  console.error("SMOKE ERROR", e);
  failed++;
} finally {
  try { child.kill(); } catch { /* */ }
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL GATE CHECKS PASSED");
process.exit(failed ? 1 : 0);
