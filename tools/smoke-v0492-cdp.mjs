#!/usr/bin/env node
/** v0.4.92 CDP 真机烟测：选择导出 UI + 助手追问（需 electron --remote-debugging-port=9222） */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.error(`  ✗ ${n}${d ? " — " + d : ""}`); process.exitCode = 1; };

async function getWsUrl() {
  const r = await fetch(`${CDP}/json/list`);
  const page = (await r.json()).find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("Electron CDP 未就绪");
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

console.log("\n── smoke-v0492-cdp ──\n");

const renderer = readFileSync(path.join(ROOT, "dist/renderer.js"), "utf8");
/exportPickMode/.test(renderer) ? pass("构建产物含选择导出") : fail("renderer 缺 export导出");
/priorTurns/.test(renderer) ? pass("构建产物含助手 priorTurns") : fail("renderer 缺 priorTurns");

const key = process.env.LUMINA_TEST_DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY || process.env.LUMINA_TEST_KEY;
if (!key) {
  console.log("  ○ 跳过 CDP AI 段（无密钥）\n");
  process.exit(process.exitCode || 0);
}

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
} catch (e) {
  console.log("  CDP 不可用:", e.message);
  process.exit(2);
}

try {
  await evalJs(cdp, `
    await window.luminaApi.setSecret("deepseek_key", ${JSON.stringify(key)});
    const s = await window.luminaApi.getSettings();
    s.llm = { provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com" };
    await window.luminaApi.saveSettings(s);
    return true;
  `);
  pass("配置 DeepSeek（钥匙串）");

  await evalJs(cdp, `
    const libTab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("文献"));
    if (libTab) { libTab.click(); await new Promise(r=>setTimeout(r,600)); }
    return true;
  `);
  pass("切到「我的文献」");

  const exportUi = await evalJs(cdp, `
    const btn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("选择导出"));
    if (!btn) return { ok: false, err: "no pick btn" };
    btn.click();
    await new Promise(r=>setTimeout(r,300));
    const bar = document.querySelector(".lib-export-bar");
    const cbs = document.querySelectorAll(".lib-card .lib-cb");
    return { ok: !!bar, cbs: cbs.length };
  `);
  exportUi?.ok ? pass("选择导出模式 UI", `勾选框 ${exportUi.cbs} 个`) : fail("选择导出 UI", exportUi?.err);

  const pages = [
    { page: 1, text: "We recruited N=60 older adults for a memory study." },
    { page: 4, text: "Limitations: single-site recruitment from one clinic." },
  ];

  const ask1 = await evalJs(cdp, `
    return await window.luminaReader.ask({ pages: ${JSON.stringify(pages)}, question: "样本量是多少？" });
  `);
  ask1?.text && /\b60\b/.test(ask1.text) ? pass("CDP reader:ask 首轮", ask1.text.slice(0, 60)) : fail("CDP ask 首轮", JSON.stringify(ask1).slice(0, 100));

  const ask2 = await evalJs(cdp, `
    return await window.luminaReader.ask({
      pages: ${JSON.stringify(pages)},
      question: "那主要局限是什么？",
      priorTurns: [{ q: "样本量是多少？", a: ${JSON.stringify(ask1.text || "")} }],
      artifacts: { summary: "N=60 memory study [p.1]" },
    });
  `);
  ask2?.text && /局限|诊所|单|site|clinic/i.test(ask2.text) ? pass("CDP reader:ask 追问（L2）", ask2.text.slice(0, 80)) : fail("CDP 追问", JSON.stringify(ask2).slice(0, 120));

  await evalJs(cdp, `
    try { await window.luminaApi.setSecret("deepseek_key", ""); } catch (e) {}
    return true;
  `);
  pass("清理 DeepSeek 钥匙串");
} finally {
  cdp.ws.close();
}

console.log("\nsmoke-v0492-cdp OK\n");
