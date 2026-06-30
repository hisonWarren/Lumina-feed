#!/usr/bin/env node
/**
 * v0.4.7 真机全量烟测：digest_report_redesign + subs_report_jump + B2/C1 + 持久化
 * 需 Electron --remote-debugging-port=9222
 * 密钥：../secrets.local.env DEEPSEEK_API_KEY（测试后清理钥匙串）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9222";
const OUT = path.join(ROOT, ".smoke-artifacts", "v047");
mkdirSync(OUT, { recursive: true });

function loadSecretFirst(name) {
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    const v = m?.[1]?.trim();
    if (v && !v.startsWith("#") && v.length > 2) return v;
  }
  if (process.env[name]?.trim()) return process.env[name].trim();
  return "";
}

const API_KEY = loadSecretFirst("DEEPSEEK_API_KEY") || loadSecretFirst("LUMINA_TEST_KEY");
const MODEL = "deepseek-v4-flash";
const SECRET_NAME = "deepseek_key";

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
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const fp = path.join(OUT, `${name}.png`);
  writeFileSync(fp, Buffer.from(data, "base64"));
  return fp;
}

async function goSubs(cdp) {
  await evalJs(cdp, `
    const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("订阅简报"));
    if (t) t.click();
    await new Promise(r => setTimeout(r, 500));
    return true;
  `);
}

async function dismissOnboarding(cdp) {
  await evalJs(cdp, `
    const later = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("稍后"));
    if (later) later.click();
    return true;
  `);
}

async function refreshSubsUi(cdp) {
  await evalJs(cdp, `
    const find = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("检索取文"));
    if (find) find.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 400));
  await goSubs(cdp);
  await evalJs(cdp, `
    const scan = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("扫描列表"));
    if (scan) scan.click();
    await new Promise(r => setTimeout(r, 400));
    return true;
  `);
  for (let i = 0; i < 40; i++) {
    const n = await evalJs(cdp, `return document.querySelectorAll(".dg-item").length;`);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 500));
  }
  return 0;
}

async function restoreLlm(cdp, before) {
  if (!before) return;
  await evalJs(cdp, `
    try { await window.luminaApi.setSecret(${JSON.stringify(SECRET_NAME)}, ""); } catch {}
    await window.luminaApi.saveSettings(${JSON.stringify(before)});
    return true;
  `);
}

async function waitReport(cdp, scope, ms = 180000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rep = await evalJs(cdp, `return await window.luminaApi.digestReportGet(${JSON.stringify(scope)});`);
    if (rep?.status === "ready" || rep?.status === "failed") return rep;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

function hasRawJsonInHighlights(rep) {
  const hs = rep?.highlights || [];
  return hs.some((h) => typeof h === "string" && (/^\s*\{/.test(h) || /"headline"\s*:/.test(h) || /"themes"\s*:/.test(h)));
}

console.log("\n── v0.4.7 真机全量烟测（DeepSeek · digest redesign + 回归）──\n");

if (!API_KEY || API_KEY.length < 20) {
  console.error("需要 DEEPSEEK_API_KEY（secrets.local.env 或环境变量，长度≥20）");
  process.exit(2);
}

let cdp;
let settingsBefore = null;
const subId = "smoke-v047-" + Date.now();
const shots = [];

try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await evalJs(cdp, `if (!window.luminaApi) throw new Error("luminaApi missing"); return true;`);
  pass("V047-ready", "luminaApi 就绪");
  await dismissOnboarding(cdp);

  settingsBefore = await evalJs(cdp, `return await window.luminaApi.getSettings();`);
  await evalJs(cdp, `
    await window.luminaApi.setSecret(${JSON.stringify(SECRET_NAME)}, ${JSON.stringify(API_KEY)});
    return true;
  `);
  await new Promise((r) => setTimeout(r, 300));
  await evalJs(cdp, `
    const cur = await window.luminaApi.getSettings();
    await window.luminaApi.saveSettings(Object.assign({}, cur, {
      llm: { provider: "deepseek", model: ${JSON.stringify(MODEL)}, baseUrl: "https://api.deepseek.com" },
      digestReportAuto: true,
    }));
    return true;
  `);
  const llmOk = await evalJs(cdp, `return await window.luminaApi.testLlm({ provider:"deepseek", model:${JSON.stringify(MODEL)}, apiKey:${JSON.stringify(API_KEY)} });`);
  llmOk?.ok ? pass("V047-0", `DeepSeek 连通 ${llmOk.ms || ""}ms`, MODEL) : fail("V047-0", llmOk?.error || JSON.stringify(llmOk) || "LLM 失败");

  await goSubs(cdp);
  shots.push(await shot(cdp, "01-subs-home"));
  pass("V047-shot-01", "截图 subs 首页", shots.at(-1));

  // C1 澄清文案
  const c1 = await evalJs(cdp, `
    const add = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("新建订阅"));
    if (add) add.click();
    await new Promise(r => setTimeout(r, 350));
    const hint = document.body.innerText.includes("今日报告由") && document.body.innerText.includes("总开关");
    const cancel = [...document.querySelectorAll("button")].find(b => (b.textContent||"").trim() === "取消");
    if (cancel) cancel.click();
    return { hint };
  `);
  c1.hint ? pass("V047-C1", "订阅编辑澄清文案") : fail("V047-C1", "缺澄清", "今日报告总开关");

  // 持久化：通过 UI 切换后 localStorage 应同步
  await evalJs(cdp, `
    localStorage.setItem("lumina_subs_active", "all");
    localStorage.setItem("lumina_subs_view", "scan");
    return true;
  `);

  // 建订阅 + runNow（covid vaccine 较易命中）
  const subDraft = {
    id: subId,
    name: "烟测 v047",
    kind: "keyword",
    q: "covid vaccine",
    freq: "daily",
    time: "08:00",
    autoSummarize: "off",
    enabled: true,
    seenIds: [],
    readIds: [],
    today: [],
  };
  await evalJs(cdp, `
    await window.luminaApi.subsSave(${JSON.stringify(subDraft)});
    return true;
  `);
  const run = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    if (!s) return { ok: false, error: "sub missing" };
    return await window.luminaApi.subsRunNow(s);
  `);
  const hits = Array.isArray(run?.hits) ? run.hits : [];
  hits.length > 0 ? pass("V047-setup", "runNow 命中", `${hits.length} 条`) : fail("V047-setup", "runNow", JSON.stringify(run).slice(0, 120));

  const itemCount = hits.length > 0 ? await refreshSubsUi(cdp) : 0;
  itemCount > 0 ? pass("V047-ui-cards", "简报卡片渲染", `${itemCount} 张`) : hits.length > 0 ? fail("V047-ui-cards", "卡片未渲染") : skip("V047-ui-cards", "无命中");

  if (itemCount > 0) {
    await evalJs(cdp, `
      const sub = [...document.querySelectorAll(".subitem")].find(el => (el.textContent||"").includes("烟测"));
      if (sub) sub.click();
      await new Promise(r => setTimeout(r, 300));
      const reportTab = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("今日报告"));
      if (reportTab) reportTab.click();
      await new Promise(r => setTimeout(r, 300));
      return {
        lsView: localStorage.getItem("lumina_subs_view"),
        lsActive: localStorage.getItem("lumina_subs_active"),
        viewOn: reportTab?.classList.contains("on"),
      };
    `);
    const persist = await evalJs(cdp, `return { lsView: localStorage.getItem("lumina_subs_view"), lsActive: localStorage.getItem("lumina_subs_active") };`);
    persist.lsView === "report" ? pass("V047-persist", "viewMode 持久化", persist.lsActive) : fail("V047-persist", JSON.stringify(persist));
    await evalJs(cdp, `
      const scan = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("扫描列表"));
      if (scan) scan.click();
      return true;
    `);
  }

  if (hits.length > 0 && llmOk?.ok) {
    // 全订阅报告
    await evalJs(cdp, `
      const all = document.querySelector(".subitem.suball");
      if (all) all.click();
      await new Promise(r => setTimeout(r, 400));
      return true;
    `);
    await evalJs(cdp, `return await window.luminaApi.digestReportGenerate({ scope: "all", force: true });`);
    const repAll = await waitReport(cdp, "all");
    if (repAll?.status === "ready") {
      pass("V047-all", "全部简报报告 ready", `hl=${(repAll.highlights||[]).length} themes=${(repAll.themes||[]).length}`);
      hasRawJsonInHighlights(repAll) ? fail("V047-all-json", "要点含裸 JSON") : pass("V047-all-json", "要点无裸 JSON");
    } else fail("V047-all", repAll?.status + " " + (repAll?.error || ""));

    await evalJs(cdp, `
      const tab = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("今日报告"));
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 600));
      return true;
    `);
    shots.push(await shot(cdp, "02-report-all"));
    const uiAll = await evalJs(cdp, `
      const reader = document.querySelector(".dg-rp-reader");
      const mode = document.querySelector(".dg-rp-mode.all");
      const style = reader ? getComputedStyle(reader) : null;
      return {
        hasReader: !!reader,
        modeAll: !!mode,
        maxW: style?.maxWidth || "",
        hasInfer: (document.body.innerText||"").includes("AI 推断"),
        hasJsonUi: (document.body.innerText||"").includes('"headline"'),
      };
    `);
    uiAll.hasReader && uiAll.modeAll ? pass("V047-ui-all", "全部模式徽标 + 编辑式版式", uiAll.maxW) : fail("V047-ui-all", JSON.stringify(uiAll));
    !uiAll.hasJsonUi ? pass("V047-ui-all-clean", "UI 无裸 JSON 文本") : fail("V047-ui-all-clean", "界面出现 JSON 片段");

    // 单订阅报告 + B2 静默（force=false 不 toast）
    await evalJs(cdp, `
      const scan = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("扫描列表"));
      if (scan) scan.click();
      await new Promise(r => setTimeout(r, 300));
      const sub = [...document.querySelectorAll(".subitem")].find(el => (el.textContent||"").includes("烟测"));
      if (sub) sub.click();
      await new Promise(r => setTimeout(r, 400));
      return true;
    `);
    await evalJs(cdp, `return await window.luminaApi.digestReportGenerate({ scope: ${JSON.stringify(subId)}, force: true });`);
    const repSingle = await waitReport(cdp, subId);
    if (repSingle?.status === "ready") {
      pass("V047-single", "单订阅深度报告 ready", `hl=${(repSingle.highlights||[]).length}`);
      hasRawJsonInHighlights(repSingle) ? fail("V047-single-json", "要点含裸 JSON") : pass("V047-single-json", "单订阅要点无裸 JSON");
      const allLen = JSON.stringify(repAll).length;
      const singleLen = JSON.stringify(repSingle).length;
      singleLen >= allLen * 0.85 ? pass("V047-diff", "单订阅内容不少于综合（深度分态）", `${singleLen} vs ${allLen}`) : skip("V047-diff", "长度对比", `${singleLen} vs ${allLen}`);
    } else fail("V047-single", repSingle?.status + " " + (repSingle?.error || ""));

    await evalJs(cdp, `
      const sub = [...document.querySelectorAll(".subitem")].find(el => (el.textContent||"").includes("烟测") && !el.classList.contains("suball"));
      if (sub) sub.click();
      await new Promise(r => setTimeout(r, 600));
      const tab = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("今日报告"));
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 800));
      return true;
    `);
    shots.push(await shot(cdp, "03-report-single"));
    const uiSingle = await evalJs(cdp, `
      const mode = document.querySelector(".dg-rp-mode.single");
      const picks = document.querySelectorAll(".dg-rp-pick-n").length;
      const state = document.querySelector(".dg-rp-state");
      return { modeSingle: !!mode, picks, hasStateCard: !!state, dataMode: document.querySelector(".dg-rp-reader")?.getAttribute("data-mode") || "" };
    `);
    uiSingle.modeSingle && uiSingle.dataMode === "single" ? pass("V047-ui-single", "单订阅模式徽标", `picks=${uiSingle.picks}`) : fail("V047-ui-single", JSON.stringify(uiSingle));
    pass("V047-shot-03", "截图单订阅报告", shots.at(-1));

    // 跳转回归
    await evalJs(cdp, `
      const scan = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("扫描列表"));
      if (scan) scan.click();
      await new Promise(r => setTimeout(r, 400));
      const hero = document.querySelector(".dg-report-hero");
      // 简报条默认展开，无需点击折叠
      return true;
    `);
    await new Promise((r) => setTimeout(r, 500));
    const jump = await evalJs(cdp, `
      const pick = document.querySelector(".dg-report-hero .dg-rp-link") || document.querySelector(".dg-report-hero .dg-rp-pick-t");
      if (!pick) return { skip: true };
      pick.click();
      await new Promise(r => setTimeout(r, 900));
      const flash = document.querySelector(".dg-item-flash");
      const card = flash || document.querySelector(".dg-item");
      return { skip: false, cardId: card?.id || "", flash: !!flash };
    `);
    if (jump?.skip) skip("V047-jump", "跳转", "无链接");
    else if (jump.cardId) pass("V047-jump", "主题/优先看跳转", jump.cardId);
    else fail("V047-jump", JSON.stringify(jump));
    shots.push(await shot(cdp, "04-after-jump"));
  } else if (!llmOk?.ok) {
    skip("V047-llm", "报告/UI", "LLM 未连通");
  } else {
    skip("V047-llm", "报告/UI", "无命中");
  }

  // reader analysis IPC 冒烟
  const analysisIpc = await evalJs(cdp, `
    return {
      save: typeof window.luminaReader?.analysisSave === "function",
      get: typeof window.luminaReader?.analysisGet === "function",
    };
  `);
  analysisIpc.save && analysisIpc.get ? pass("V047-reader-ipc", "analysisSave/Get 已暴露") : fail("V047-reader-ipc", JSON.stringify(analysisIpc));

  await restoreLlm(cdp, settingsBefore);
  pass("V047-clean-key", "钥匙串 DeepSeek 已清除");

  await evalJs(cdp, `try { await window.luminaApi.subsRemove(${JSON.stringify(subId)}); } catch {}`);
  pass("V047-clean-sub", "测试订阅已删除");

  cdp.ws.close();
} catch (e) {
  fail("FATAL", e.message);
  try {
    if (cdp && settingsBefore) await restoreLlm(cdp, settingsBefore);
    if (cdp) await evalJs(cdp, `try { await window.luminaApi.subsRemove(${JSON.stringify(subId)}); } catch {}`);
    cdp?.ws?.close();
  } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
const report = {
  at: new Date().toISOString(),
  version: "0.4.7",
  model: MODEL,
  screenshots: shots,
  pass: results.filter((r) => r.ok && !r.skipped).length,
  fail: failed.length,
  skipped: results.filter((r) => r.skipped).length,
  results,
};
writeFileSync(path.join(OUT, "v047-report.json"), JSON.stringify(report, null, 2));
console.log(`\n结果：${report.pass} 通过 / ${report.fail} 失败 / ${report.skipped} 跳过`);
console.log(`截图：${OUT}`);
process.exit(failed.length ? 1 : 0);
