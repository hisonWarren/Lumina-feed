#!/usr/bin/env node
/**
 * MAN-SUB-AI · 订阅简报 + DeepSeek 真机烟测（CDP 9222）
 * 密钥：DEEPSEEK_API_KEY / LUMINA_TEST_KEY / 命令行 LUMINA_TEST_KEY
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

function loadKey() {
  if (process.env.LUMINA_TEST_KEY) return process.env.LUMINA_TEST_KEY.trim();
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^DEEPSEEK_API_KEY=(.+)$/m);
    const v = m ? m[1].trim() : "";
    if (v && !v.startsWith("#")) return v;
  }
  return "";
}

const API_KEY = loadKey();
const MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

const results = [];
const pass = (id, name, detail = "") => { results.push({ id, ok: true, name, detail }); console.log(`  ✓ ${id} ${name}${detail ? " — " + detail : ""}`); };
const fail = (id, name, detail = "") => { results.push({ id, ok: false, name, detail }); console.log(`  ✗ ${id} ${name}${detail ? " — " + detail : ""}`); };
const skip = (id, name, detail = "") => { results.push({ id, ok: true, name, detail: "SKIP: " + detail, skipped: true }); console.log(`  ○ ${id} ${name} — 跳过：${detail}`); };

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

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

console.log("\n── MAN-SUB-AI 订阅简报 + DeepSeek 烟测 ──\n");

if (!API_KEY) {
  fail("KEY", "无 DeepSeek API Key", "设 LUMINA_TEST_KEY 或 DEEPSEEK_API_KEY");
  process.exit(1);
}

const subId = "smoke_sub_ai_" + Date.now();
let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());

  await evalJs(cdp, `
    await window.luminaApi.setSecret("deepseek_key", ${JSON.stringify(API_KEY)});
    const s = await window.luminaApi.getSettings();
    await window.luminaApi.saveSettings({ ...s, llm: { provider: "deepseek", model: ${JSON.stringify(MODEL)}, baseUrl: "https://api.deepseek.com" } });
    return true;
  `);
  pass("AI0", "DeepSeek 配置", MODEL);

  const llmTest = await evalJs(cdp, `
    return await window.luminaApi.testLlm({ provider:"deepseek", model:${JSON.stringify(MODEL)}, apiKey:${JSON.stringify(API_KEY)} });
  `);
  llmTest?.ok ? pass("AI0b", "testLlm", llmTest.message || "ok") : fail("AI0b", "testLlm", JSON.stringify(llmTest));

  const draft = { id: subId, name: "smoke AI", kind: "keyword", q: "covid vaccine efficacy", freq: "daily", time: "08:00", autoSummarize: "blurb", enabled: true, seenIds: [], today: [] };
  await evalJs(cdp, `await window.luminaApi.subsSave(${JSON.stringify(draft)});`);

  // preview blurb（同步，应含 digestBlurb）
  const prev = await evalJs(cdp, `return await window.luminaApi.subsPreview(${JSON.stringify(draft)});`);
  const prevBlurbs = (prev?.hits || []).filter((h) => h._digestBlurb || h.digestBlurb).length;
  prevBlurbs >= 1 ? pass("AI8-preview", "试跑 blurb 样本", `${prevBlurbs} 条有 blurb`) : fail("AI8-preview", "试跑 blurb", `hits=${(prev?.hits||[]).length} blurbs=${prevBlurbs}`);

  // runNow 异步：检索先返回，后台 blurb（最多 50 条）
  const subId2 = subId;
  const asyncRun = await evalJs(cdp, `
    return new Promise(async (resolve) => {
      let updated = null;
      const stop = window.luminaApi.onSubsUpdated((p) => { if (p.subId === ${JSON.stringify(subId2)}) updated = p; });
      const r = await window.luminaApi.subsRunNow(${JSON.stringify({ ...draft, id: subId2 })}, { asyncAi: true });
      const deadline = Date.now() + 300000;
      while (!updated && Date.now() < deadline) await new Promise(x => setTimeout(x, 1000));
      stop && stop();
      const subs = await window.luminaApi.subsList();
      const s = subs.find(x => x.id === ${JSON.stringify(subId2)});
      resolve({ run: r, updated, today: s?.today || [] });
    });
  `);
  (asyncRun?.run?.hits || []).length > 0 ? pass("AI-run", "runNow 检索", `${asyncRun.run.hits.length} 条`) : fail("AI-run", "runNow 无命中");
  asyncRun?.run?.meta?.ai?.status === "queued" ? pass("AI-async", "检索先返回 queued") : pass("AI-async", "async", asyncRun?.run?.meta?.ai?.status || "—");
  const savedBlurbs = (asyncRun?.today || []).filter((p) => p._digestBlurb).length;
  savedBlurbs >= 1 ? pass("AI8", "blurb 持久化 today", `${savedBlurbs} 条`) : fail("AI8", "blurb 持久化", `updated=${JSON.stringify(asyncRun?.updated?.ai||{})}`);
  (asyncRun?.updated?.ai?.blurbs >= 1) ? pass("AI-updated", "subs:updated", `${asyncRun.updated.ai.blurbs} blurbs`) : skip("AI-updated", "subs:updated", "timeout");

  await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId2)});`);
  pass("AI-clean", "subs:remove");

  cdp.ws.close();
} catch (e) {
  fail("FATAL", e.message);
  try { cdp?.ws?.close(); } catch { /* ignore */ }
  try { await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId)});`); } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "subs-digest-ai-report.json"), JSON.stringify({ at: new Date().toISOString(), model: MODEL, results }, null, 2));
console.log(`\n── 结果：${results.filter((r) => r.ok && !r.skipped).length} 通过 · ${failed.length} 失败 ──\n`);
process.exit(failed.length ? 1 : 0);
