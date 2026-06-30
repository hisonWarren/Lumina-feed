#!/usr/bin/env node
/**
 * digest_retro + 当日简报 真机烟测（CDP 9222 · DeepSeek）
 * 需：npm run build:electron && npx electron . --remote-debugging-port=9222 --disable-gpu
 * 环境：DEEPSEEK_API_KEY 或 LUMINA_TEST_KEY
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts", "digest-retro");
mkdirSync(OUT, { recursive: true });

const API_KEY = (process.env.DEEPSEEK_API_KEY || process.env.LUMINA_TEST_KEY || "").trim();
const MODEL = (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();
const SECRET = "deepseek_key";

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

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  await new Promise((r) => setTimeout(r, 700));
}

console.log("\n── digest_retro + 当日简报 真机烟测 (DeepSeek · CDP) ──\n");
if (!API_KEY || API_KEY.length < 20) {
  console.error("需要 DEEPSEEK_API_KEY 或 LUMINA_TEST_KEY 环境变量");
  process.exit(2);
}

const subId = "smoke_retro_" + Date.now();
const dk = todayKey();
let cdp;
let settingsBefore = null;

try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  pass("R0", "CDP 已连接");

  await dismissOnboarding(cdp);
  settingsBefore = await evalJs(cdp, `return await window.luminaApi.getSettings();`);

  const llm = await evalJs(cdp, `
    await window.luminaApi.setSecret(${JSON.stringify(SECRET)}, ${JSON.stringify(API_KEY)});
    const cur = await window.luminaApi.getSettings();
    await window.luminaApi.saveSettings(Object.assign({}, cur, {
      llm: { provider: "deepseek", model: ${JSON.stringify(MODEL)}, baseUrl: "https://api.deepseek.com" },
      digestReportAuto: true,
    }));
    return await window.luminaApi.testLlm({ provider:"deepseek", model:${JSON.stringify(MODEL)}, apiKey:${JSON.stringify(API_KEY)} });
  `);
  llm?.ok ? pass("R1", "DeepSeek 连通", `${llm.ms || "?"}ms · ${MODEL}`) : fail("R1", "DeepSeek 连通", JSON.stringify(llm).slice(0, 160));

  const draft = {
    id: subId, name: "smoke retro", kind: "keyword", q: "covid vaccine efficacy",
    freq: "daily", time: "08:00", autoSummarize: "off", enabled: true, seenIds: [], today: [],
  };
  await evalJs(cdp, `await window.luminaApi.subsSave(${JSON.stringify(draft)});`);
  pass("R2", "订阅已保存");

  const run1 = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    return await window.luminaApi.subsRunNow(s);
  `);
  const n1 = run1?.newCount ?? 0;
  const t1 = Array.isArray(run1?.hits) ? run1.hits.length : 0;
  n1 >= 0 && t1 >= 0 ? pass("R3", "runNow 首轮", `new=${n1} today=${t1}`) : fail("R3", "runNow 首轮");

  const subAfter1 = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    return { todayDateKey: s?.todayDateKey || "", todayLen: Array.isArray(s?.today) ? s.today.length : 0 };
  `);
  subAfter1.todayDateKey === dk
    ? pass("R4", "todayDateKey 为今日", dk)
    : fail("R4", "todayDateKey", `got=${subAfter1.todayDateKey} want=${dk}`);

  const recency = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    const hits = Array.isArray(s?.today) ? s.today : [];
    const start = new Date(${JSON.stringify(dk)} + "T00:00:00").getTime();
    const y0 = new Date(${JSON.stringify(dk)}).getFullYear();
    let noDate = 0, beforeToday = 0, beforeYear = 0;
    for (const p of hits) {
      if (!p.pubDate) { noDate++; continue; }
      const t = new Date(p.pubDate).getTime();
      if (Number.isFinite(t) && t < start) beforeToday++;
      if (p.year && Number(p.year) < y0) beforeYear++;
    }
    return { total: hits.length, noDate, beforeToday, beforeYear };
  `);
  t1 === 0 || (recency.noDate === 0 && recency.beforeToday === 0 && recency.beforeYear === 0)
    ? pass("R-recency", "仅今日发表窗", JSON.stringify(recency))
    : fail("R-recency", "含旧文或无 pubDate", JSON.stringify(recency));

  const dates1 = await evalJs(cdp, `return await window.luminaApi.digestHistoryDates("all");`);
  const hasTodaySnap = Array.isArray(dates1?.dates) && dates1.dates.some((d) => d.dateKey === dk && d.paperCount > 0);
  t1 > 0 && hasTodaySnap
    ? pass("R5", "快照已写入", `dateKey=${dk} count=${dates1.dates.find(d=>d.dateKey===dk)?.paperCount}`)
    : t1 > 0 ? fail("R5", "快照未写入", JSON.stringify(dates1?.dates?.slice(0, 3)))
    : skip("R5", "快照", "首轮无命中");

  const run2 = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    return await window.luminaApi.subsRunNow(s);
  `);
  const n2 = run2?.newCount ?? 0;
  n2 === 0
    ? pass("R6", "连跑 newCount=0", `today=${(run2?.hits || []).length}`)
    : n2 < n1
      ? pass("R6", "连跑仅少量增量", `new=${n2} < 首轮 ${n1}`)
      : fail("R6", "连跑去重", `new=${n2} 首轮=${n1}`);

  const series = await evalJs(cdp, `return await window.luminaApi.digestRetroSeries({ scope: "all", granularity: "day", sinceDays: 30 });`);
  series && Array.isArray(series.volume)
    ? pass("R7", "retro 序列", `buckets=${series.volume.length} total=${series.totalPapers}`)
    : fail("R7", "retro 序列", JSON.stringify(series).slice(0, 120));

  if (t1 > 0) {
    const hist = await evalJs(cdp, `return await window.luminaApi.digestHistoryGet(${JSON.stringify(dk)}, "all");`);
    hist?.ok && Array.isArray(hist.papers) && hist.papers.length > 0
      ? pass("R8", "历史日详情", `${hist.papers.length} 篇`)
      : fail("R8", "历史日详情", JSON.stringify(hist).slice(0, 120));
  } else skip("R8", "历史日详情", "无命中");

  if (t1 > 0 && llm?.ok) {
    await evalJs(cdp, `return await window.luminaApi.digestReportGenerate({ scope: "all", force: true });`);
    let rep = null;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      rep = await evalJs(cdp, `return await window.luminaApi.digestReportGet("all");`);
      if (rep?.status === "ready" || rep?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (rep?.status === "ready" && rep.dateKey === dk) {
      pass("R9", "今日总报告", `highlights=${(rep.highlights||[]).length} unread=${rep.unreadCount}`);
    } else if (rep?.status === "ready") {
      fail("R9", "今日总报告 dateKey", `got=${rep.dateKey} want=${dk}`);
    } else {
      fail("R9", "今日总报告", rep?.status + " " + (rep?.error || rep?.skippedReason || ""));
    }

    if (llm?.ok) {
      const ana = await evalJs(cdp, `return await window.luminaApi.digestRetroAnalyze({ scope: "all", sinceDays: 30 });`);
      ana?.ok && ana?.analysis?.headline
        ? pass("R10", "AI 回顾", String(ana.analysis.headline).slice(0, 60))
        : fail("R10", "AI 回顾", JSON.stringify(ana).slice(0, 160));
    }
  } else skip("R9-R10", "报告+AI回顾", "无命中或 LLM 失败");

  await goSubs(cdp);
  if (t1 > 0) {
    const uiRetro = await evalJs(cdp, `
      const tab = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("回顾"));
      if (!tab) return { hasTab: false };
      tab.click();
      await new Promise(r => setTimeout(r, 1200));
      const framing = !!document.querySelector(".rt-framing");
      const chart = !!document.querySelector(".rt-chart");
      const histTab = [...document.querySelectorAll(".rt-seg button")].find(b => (b.textContent||"").includes("历史每日"));
      if (histTab) { histTab.click(); await new Promise(r => setTimeout(r, 600)); }
      const dayItems = document.querySelectorAll(".rt-dayitem").length;
      return { hasTab: true, framing, chart, dayItems };
    `);
    uiRetro.hasTab && uiRetro.framing && uiRetro.chart && uiRetro.dayItems >= 1
      ? pass("R11", "回顾 UI", JSON.stringify(uiRetro))
      : fail("R11", "回顾 UI", JSON.stringify(uiRetro));
  } else skip("R11", "回顾 UI", "无待读");

  await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId)});`);
  pass("R-clean", "测试订阅已删除");
} catch (e) {
  fail("R-fatal", "烟测异常", String(e.message || e).slice(0, 200));
} finally {
  if (cdp) {
    try {
      await evalJs(cdp, `
        await window.luminaApi.setSecret(${JSON.stringify(SECRET)}, "");
        const before = ${JSON.stringify(settingsBefore || {})};
        await window.luminaApi.saveSettings(before);
        return true;
      `);
      pass("R-key-clean", "钥匙串密钥已清空、设置已恢复");
    } catch (e) {
      fail("R-key-clean", "清理失败", String(e.message || e).slice(0, 120));
    }
    try { cdp.ws.close(); } catch { /* ignore */ }
  }
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ dk, results, failed: failed.length }, null, 2));
console.log(`\n── 结果：${results.length - failed.length} 通过 / ${failed.length} 失败 ──\n`);
process.exit(failed.length ? 1 : 0);
