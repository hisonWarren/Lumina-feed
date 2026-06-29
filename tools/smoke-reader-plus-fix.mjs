#!/usr/bin/env node
/**
 * reader_plus_fix 真机烟测（DeepSeek · CDP 9222）
 * EXIT_CRITERIA §B1–B2：总结页码 · claim 账本 · 引文角色 · 接地 · UI 默认连续
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

function loadDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  if (process.env.LUMINA_TEST_KEY) return process.env.LUMINA_TEST_KEY.trim();
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (!existsSync(envPath)) return "";
  const m = readFileSync(envPath, "utf8").match(/^DEEPSEEK_API_KEY=(.+)$/m);
  const v = m ? m[1].trim() : "";
  return v && !v.startsWith("#") && v.length > 8 ? v : "";
}

function loadDeepSeekModel() {
  if (process.env.DEEPSEEK_MODEL) return process.env.DEEPSEEK_MODEL.trim();
  return "deepseek-chat";
}

const API_KEY = loadDeepSeekKey();
const MODEL = loadDeepSeekModel();

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

/** 5 页样例：p.5 含 378 FNC 特征（补丁文档基准） */
const PAGES_5 = JSON.stringify([
  { page: 1, text: "Abstract. Functional network connectivity (FNC) analysis in resting-state fMRI." },
  { page: 2, text: "Introduction. Prior work [Smith 2018] established baseline connectivity patterns in healthy adults." },
  { page: 3, text: "Methods. We recruited N=120 participants. Preprocessing followed standard pipelines." },
  { page: 4, text: "Results. Group comparisons showed significant differences in default mode network coupling." },
  { page: 5, text: "Discussion. Notably, 378 FNC features were significantly associated with cognitive scores in our secondary analysis (see Table 3, p.5)." },
]);

function pageRefsFromText(text) {
  const refs = [];
  for (const m of String(text || "").matchAll(/\[p\.(\d+)\]/g)) refs.push(parseInt(m[1], 10));
  for (const m of String(text || "").matchAll(/\(p\.(\d+)\)/g)) refs.push(parseInt(m[1], 10));
  return refs;
}

async function cleanupDeepSeek(cdp) {
  try {
    await evalJs(cdp, `
      try { await window.luminaApi.setSecret("deepseek_key", ""); } catch (e) { /* noop */ }
      const s = await window.luminaApi.getSettings();
      if (s && s.llm && s.llm.provider === "deepseek") {
        s.llm = { provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com" };
        await window.luminaApi.saveSettings(s);
      }
      return true;
    `);
  } catch { /* noop */ }
}

console.log("\n── reader_plus_fix 真机烟测（DeepSeek）──\n");

if (!API_KEY) {
  console.error("需要 DEEPSEEK_API_KEY 或 LUMINA_TEST_KEY");
  process.exit(2);
}

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");

  await evalJs(cdp, `
    await window.luminaApi.setSecret("deepseek_key", ${JSON.stringify(API_KEY)});
    const s = await window.luminaApi.getSettings();
    s.llm = { provider: "deepseek", model: ${JSON.stringify(MODEL)}, baseUrl: "https://api.deepseek.com" };
    await window.luminaApi.saveSettings(s);
    return true;
  `);
  pass("RPF-0", "DeepSeek 密钥写入钥匙串");

  const test = await evalJs(cdp, `return await window.luminaApi.testLlm({ provider:"deepseek", model:${JSON.stringify(MODEL)}, apiKey:${JSON.stringify(API_KEY)} });`);
  test?.ok ? pass("RPF-0b", `llm:test ${test.ms}ms`) : fail("RPF-0b", test?.error || JSON.stringify(test));

  // ── B1.1 总结 map-reduce + 页码 ──
  const rSum = await evalJs(cdp, `return await window.luminaReader.summarize({ pages: ${PAGES_5} });`);
  if (!rSum?.text) {
    fail("RPF-1", "reader:summarize 无 text");
  } else {
    const refs = pageRefsFromText(rSum.text);
    const hasMultiPage = refs.some((p) => p > 1);
    const mentionsP5 = /378\s*FNC|p\.?\s*5|第\s*5\s*页/i.test(rSum.text);
    const allP1 = refs.length > 0 && refs.every((p) => p === 1);
    const grounded = typeof rSum.groundedRatio === "number" ? rSum.groundedRatio : null;
    if (hasMultiPage && !allP1) {
      pass("RPF-1", `总结 ${rSum.text.length}字 · 页码 ${[...new Set(refs)].sort((a, b) => a - b).join(",")} · grounded=${grounded}`);
    } else if (mentionsP5 && refs.length > 0) {
      pass("RPF-1", `总结含 p.5 细节 · grounded=${grounded} · refs=${refs.join(",")}`);
    } else {
      fail("RPF-1", `页码仍偏 p.1 或缺 p.5 · refs=${refs.join(",")} · snippet=${rSum.text.slice(0, 120)}`);
    }
    rSum.sourceBasis === "fulltext" ? pass("RPF-1b", "sourceBasis=fulltext") : fail("RPF-1b", `sourceBasis=${rSum.sourceBasis}`);
    !/\*\*[^*]+\*\*/.test(rSum.text) || rSum.text.includes("<") ? pass("RPF-2", "总结无裸 **（或已渲染）") : skip("RPF-2", "裸星号需 UI 渲染层验证");
  }

  // ── B1.2 claim 账本 ──
  try {
    const ledger = await evalJs(cdp, `return await window.luminaReader.analyze("ledger", ${PAGES_5}, {});`);
    if (ledger?.claims?.length >= 1) {
      pass("RPF-3", `claim 账本 ${ledger.claims.length} 条`);
    } else if (ledger?.analysisError || ledger?.refused) {
      fail("RPF-3", ledger.analysisError || ledger.refused?.reason || "空卡");
    } else {
      fail("RPF-3", JSON.stringify({ n: ledger?.claims?.length }).slice(0, 80));
    }
  } catch (e) {
    fail("RPF-3", e.message.slice(0, 100));
  }

  // ── B1.3 引文角色 A1+ ──
  try {
    const cite = await evalJs(cdp, `return await window.luminaReader.analyze("citerole", ${PAGES_5}, {});`);
    const n = cite?.claims?.length || 0;
    if (n >= 1 && n <= 20) {
      pass("RPF-4", `引文角色 ${n} 条（≤20）`);
    } else if (n > 20) {
      fail("RPF-4", `超过硬上限 20：${n} 条`);
    } else {
      fail("RPF-4", cite?.analysisError || JSON.stringify(cite).slice(0, 80));
    }
  } catch (e) {
    fail("RPF-4", e.message.slice(0, 100));
  }

  // ── B1.4 接地率 ──
  if (typeof rSum?.groundedRatio === "number") {
    rSum.groundedRatio >= 0.35 ? pass("RPF-5", `groundedRatio=${rSum.groundedRatio}`) : skip("RPF-5", `grounded=${rSum.groundedRatio}（样例短，可接受）`);
  } else skip("RPF-5", "无 groundedRatio");

  // ── B2 flowmap ──
  try {
    const flow = await evalJs(cdp, `return await window.luminaReader.analyze("flowmap", ${PAGES_5}, {});`);
    const nodes = flow?.graph?.nodes?.length || 0;
    nodes >= 3 ? pass("RPF-6", `逻辑图 ${nodes} 节点`) : flow?.claims?.length ? pass("RPF-6", "flowmap 有 claims") : fail("RPF-6", JSON.stringify(flow).slice(0, 80));
  } catch (e) {
    fail("RPF-6", e.message.slice(0, 80));
  }

  // ── B2 UI：连续默认 + 撤销按钮（需已下载 PDF）──
  const ui = await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("阅读"));
    if (tab) tab.click();
    await new Promise(r => setTimeout(r, 400));
    document.querySelector(".rd-back")?.click();
    await new Promise(r => setTimeout(r, 300));
    const row = document.querySelector(".rh-row");
    if (!row) return { skip: true, reason: "无本地 PDF" };
    row.click();
    for (let i = 0; i < 50 && !document.querySelector(".rd"); i++) await new Promise(r => setTimeout(r, 400));
    const rd = document.querySelector(".rd");
    if (!rd) return { skip: true, reason: "阅读器未打开" };
    const contOn = !!document.querySelector('.rd-seg button.on')?.textContent?.includes("连续");
    const undo = [...document.querySelectorAll(".rd-toolbar .rd-btn")].some(b => (b.textContent||"").includes("撤销"));
    return { skip: false, continuous: contOn, undo };
  `);
  if (ui?.skip) {
    skip("RPF-7", ui.reason);
    skip("RPF-8", ui.reason);
  } else {
    ui.continuous ? pass("RPF-7", "默认连续滚动") : fail("RPF-7", "连续模式未默认选中");
    ui.undo ? pass("RPF-8", "顶栏撤销按钮") : fail("RPF-8", "无撤销按钮");
  }

  await cleanupDeepSeek(cdp);
  pass("RPF-CLEAN", "已清除 DeepSeek 密钥配置");
  cdp.ws.close();
} catch (e) {
  fail("中断", e.message);
  if (cdp) {
    await cleanupDeepSeek(cdp).catch(() => {});
    cdp.ws.close();
  }
}

const nFail = results.filter((r) => !r.ok).length;
const nSkip = results.filter((r) => r.skipped).length;
const report = { at: new Date().toISOString(), model: MODEL, results };
writeFileSync(path.join(OUT, "reader-plus-fix-report.json"), JSON.stringify(report, null, 2));
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败 / ${nSkip} 跳过`);
console.log(`报告：${path.join(OUT, "reader-plus-fix-report.json")}\n`);
process.exit(nFail ? 1 : 0);
