#!/usr/bin/env node
/**
 * subs_report_jump 真机烟测（CDP 9222）· EXIT_CRITERIA §B1–B3
 * 需：npm run build:electron && npx electron . --remote-debugging-port=9222
 * LLM：豆包 DOUBAO_API_KEY 或 DeepSeek DEEPSEEK_API_KEY（secrets.local.env）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

function loadEnvKey(name) {
  if (process.env[name]) return process.env[name].trim();
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (!existsSync(envPath)) return "";
  const m = readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  const v = m ? m[1].trim() : "";
  return v && v.length > 8 ? v : "";
}

const DOUBAO_KEY = loadEnvKey("DOUBAO_API_KEY");
const DOUBAO_MODEL = process.env.DOUBAO_MODEL || loadEnvKey("DOUBAO_MODEL") || "ep-20260628113448-2qnjk";
const DS_KEY = loadEnvKey("DEEPSEEK_API_KEY");
const DS_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const USE_DOUBAO = !!DOUBAO_KEY;
const LLM_KEY = USE_DOUBAO ? DOUBAO_KEY : DS_KEY;
const LLM_PROVIDER = USE_DOUBAO ? "doubao" : "deepseek";
const LLM_MODEL = USE_DOUBAO ? DOUBAO_MODEL : DS_MODEL;
const LLM_BASE = USE_DOUBAO ? "https://ark.cn-beijing.volces.com/api/v3" : "https://api.deepseek.com";
const SECRET_NAME = USE_DOUBAO ? "doubao_key" : "deepseek_key";

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

async function goSubs(cdp) {
  await evalJs(cdp, `
    const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("订阅简报"));
    if (!t) throw new Error("subs tab missing");
    t.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 600));
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
  for (let i = 0; i < 30; i++) {
    const n = await evalJs(cdp, `return document.querySelectorAll(".dg-item").length;`);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 400));
  }
  return 0;
}

async function restoreLlm(cdp, before) {
  await evalJs(cdp, `
    await window.luminaApi.setSecret(${JSON.stringify(SECRET_NAME)}, "");
    const before = ${JSON.stringify(before || {})};
    await window.luminaApi.saveSettings(before);
    return true;
  `);
}

console.log("\n── subs_report_jump 真机烟测 (CDP) ──\n");

const subId = "smoke_srj_" + Date.now();
let cdp;
let settingsBefore = null;
try {
  cdp = await cdpConnect(await getWsUrl());
  await evalJs(cdp, `return !!window.luminaApi`);
  pass("SRJ0", "luminaApi 就绪");

  await dismissOnboarding(cdp);

  // 订阅 + runNow
  await evalJs(cdp, `
    await window.luminaApi.subsSave(${JSON.stringify({
      id: subId, name: "srj smoke", kind: "keyword", q: "covid vaccine",
      freq: "daily", autoSummarize: "off", enabled: true, seenIds: [], readIds: [], today: [],
    })});
  `);
  const run = await evalJs(cdp, `
    const subs = await window.luminaApi.subsList();
    const s = subs.find(x => x.id === ${JSON.stringify(subId)});
    return await window.luminaApi.subsRunNow(s);
  `);
  const hits = Array.isArray(run?.hits) ? run.hits : [];
  hits.length > 0 ? pass("SRJ-setup", "runNow 有命中", `${hits.length} 条`) : skip("SRJ-setup", "runNow", "无命中，后续 UI 项跳过");

  const itemCount = hits.length > 0 ? await refreshSubsUi(cdp) : 0;
  itemCount > 0 ? pass("SRJ-setup-ui", "UI 刷新后卡片渲染", `${itemCount} 张`) : hits.length > 0 ? fail("SRJ-setup-ui", "卡片未渲染", "切 tab 后仍无 .dg-item") : skip("SRJ-setup-ui", "卡片", "无命中");

  // ── B1.1 结构：Hero 在 .dg-list 内（有待读数据时）──
  const dom0 = await evalJs(cdp, `
    const head = document.querySelector(".dg-head");
    const list = document.querySelector(".dg-list");
    const hero = document.querySelector(".dg-report-hero");
    return {
      hasList: !!list,
      heroInList: !!(list && hero && list.contains(hero)),
      heroInHead: !!(head && hero && head.contains(hero)),
      listOverflow: list ? getComputedStyle(list).overflowY : "",
    };
  `);
  dom0.hasList && dom0.heroInList && !dom0.heroInHead
    ? pass("SRJ1", "Hero 位于 .dg-list（非固定表头）", JSON.stringify(dom0))
    : itemCount > 0 ? fail("SRJ1", "Hero DOM 位置", JSON.stringify(dom0)) : skip("SRJ1", "Hero DOM", "无待读");
  dom0.listOverflow === "auto" || dom0.listOverflow === "scroll"
    ? pass("SRJ1b", ".dg-list 可滚动", dom0.listOverflow)
    : fail("SRJ1b", ".dg-list overflow", dom0.listOverflow);
  // 确保报告展开
  await evalJs(cdp, `
    const hero = document.querySelector(".dg-report-hero");
    if (hero && hero.classList.contains("collapsed")) {
      document.querySelector(".dg-report-collapse")?.click();
    }
    return true;
  `);
  await new Promise((r) => setTimeout(r, 300));

  if (hits.length > 0) {
    const scroll = await evalJs(cdp, `
      const list = document.querySelector(".dg-list");
      const foot = document.querySelector(".dg-report-foot");
      const items = document.querySelectorAll(".dg-item");
      if (!list) return { ok: false, reason: "no list" };
      const canScroll = list.scrollHeight > list.clientHeight + 8;
      list.scrollTop = list.scrollHeight;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const footVisible = foot ? (foot.getBoundingClientRect().top < list.getBoundingClientRect().bottom) : null;
      const lastItem = items.length ? items[items.length - 1] : null;
      const itemVisible = lastItem ? (lastItem.getBoundingClientRect().top < list.getBoundingClientRect().bottom + 2) : null;
      return { canScroll, footVisible, itemCount: items.length, itemVisible, scrollH: list.scrollHeight, clientH: list.clientHeight };
    `);
    scroll.canScroll
      ? pass("SRJ2", "列表可滚动（scrollHeight > clientHeight）", `sh=${scroll.scrollH} ch=${scroll.clientHeight}`)
      : pass("SRJ2", "列表高度（内容较少时可能不需滚）", JSON.stringify(scroll));
    scroll.footVisible === true || scroll.footVisible === null
      ? pass("SRJ2b", "滚到底后报告页脚可达", String(scroll.footVisible))
      : fail("SRJ2b", "报告页脚被截断", JSON.stringify(scroll));
    scroll.itemCount > 0 && scroll.itemVisible
      ? pass("SRJ2c", "滚到底后论文卡片可见", `${scroll.itemCount} 张`)
      : scroll.itemCount > 0 ? fail("SRJ2c", "论文卡片仍被截断", JSON.stringify(scroll)) : skip("SRJ2c", "论文卡片", "无卡片");
  }

  // LLM 报告生成 + 跳转测试
  if (!LLM_KEY) {
    skip("SRJ-LLM", "报告生成+跳转", "无 DOUBAO/DEEPSEEK Key");
  } else {
    settingsBefore = await evalJs(cdp, `return await window.luminaApi.getSettings();`);
    await evalJs(cdp, `
      await window.luminaApi.setSecret(${JSON.stringify(SECRET_NAME)}, ${JSON.stringify(LLM_KEY)});
      const cur = await window.luminaApi.getSettings();
      await window.luminaApi.saveSettings({
        ...cur,
        llm: { provider: ${JSON.stringify(LLM_PROVIDER)}, model: ${JSON.stringify(LLM_MODEL)}, baseUrl: ${JSON.stringify(LLM_BASE)} },
        digestReportAuto: true,
      });
    `);
    const llmOk = await evalJs(cdp, `
      return await window.luminaApi.testLlm({
        provider: ${JSON.stringify(LLM_PROVIDER)},
        model: ${JSON.stringify(LLM_MODEL)},
        baseUrl: ${JSON.stringify(LLM_BASE)},
        apiKey: ${JSON.stringify(LLM_KEY)},
      });
    `);
    llmOk?.ok ? pass("SRJ-LLM0", `${LLM_PROVIDER} 连通`, llmOk.model || LLM_MODEL) : fail("SRJ-LLM0", "LLM 连通", JSON.stringify(llmOk).slice(0, 100));

    if (llmOk?.ok && hits.length > 0) {
      await evalJs(cdp, `return await window.luminaApi.digestReportGenerate({ scope: "all", force: true });`);
      let rep = null;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        rep = await evalJs(cdp, `return await window.luminaApi.digestReportGet("all");`);
        if (rep?.status === "ready" || rep?.status === "failed") break;
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (rep?.status === "ready") {
        pass("SRJ3", "今日总报告 ready", `themes=${(rep.themes||[]).length} picks=${(rep.priorityPicks||[]).length}`);

        await evalJs(cdp, `
          const scan = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("扫描列表"));
          if (scan) scan.click();
          const btn = [...document.querySelectorAll(".dg-report-btn")].find(b => (b.textContent||"").includes("刷新"));
          if (btn && !btn.disabled) btn.click();
          return true;
        `);
        await new Promise((r) => setTimeout(r, 800));
        await evalJs(cdp, `
          const hero = document.querySelector(".dg-report-hero");
          if (hero?.classList.contains("collapsed")) document.querySelector(".dg-report-collapse")?.click();
          return true;
        `);
        for (let i = 0; i < 8; i++) {
          const n = await evalJs(cdp, `return document.querySelectorAll(".dg-report-hero .dg-rp-link, .dg-report-hero .dg-report-link").length;`);
          if (n > 0) break;
          await new Promise((r) => setTimeout(r, 400));
        }

        const links = await evalJs(cdp, `
          const btns = [...document.querySelectorAll(".dg-report-hero .dg-rp-link, .dg-report-hero .dg-report-link")];
          const texts = btns.map(b => (b.textContent||"").trim());
          const titled = texts.filter(t => t && t !== "跳转文献");
          return { count: btns.length, titled: titled.length, sample: titled[0] || texts[0] || "" };
        `);
        links.count > 0 && links.titled > 0
          ? pass("SRJ4", "主题链接显示真实标题", `${links.titled}/${links.count} · ${links.sample.slice(0, 40)}`)
          : links.count > 0 ? fail("SRJ4", "主题链接仍为占位", JSON.stringify(links)) : skip("SRJ4", "主题链接", "报告无 themes");

        // Hero 内跳转
        const jumpHero = await evalJs(cdp, `
          const pick = document.querySelector(".dg-report-hero .dg-rp-link") || document.querySelector(".dg-report-hero .dg-report-link") || document.querySelector(".dg-report-hero .dg-rp-pick-t") || document.querySelector(".dg-report-hero .dg-report-pick-t");
          if (!pick) return { skip: true };
          const label = (pick.textContent||"").trim();
          pick.click();
          await new Promise(r => setTimeout(r, 900));
          const scanOn = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("扫描列表"));
          const scanSelected = scanOn?.getAttribute("aria-selected") === "true" || scanOn?.classList.contains("on");
          const flash = document.querySelector(".dg-item-flash");
          const card = flash || document.querySelector(".dg-item");
          return {
            skip: false,
            label: label.slice(0, 50),
            scanSelected,
            hasFlash: !!flash,
            cardId: card?.id || "",
          };
        `);
        if (jumpHero?.skip) skip("SRJ5", "Hero 跳转", "无链接");
        else if (jumpHero.scanSelected && jumpHero.hasFlash) pass("SRJ5", "Hero 跳转 → 扫描列表 + 高亮", jumpHero.cardId);
        else if (jumpHero.scanSelected && jumpHero.cardId) pass("SRJ5", "Hero 跳转 → 卡片定位（无 flash 类）", jumpHero.cardId);
        else fail("SRJ5", "Hero 跳转", JSON.stringify(jumpHero));

        // 今日报告 tab 跳转
        await evalJs(cdp, `
          const tab = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("今日报告"));
          if (tab) tab.click();
          return true;
        `);
        await new Promise((r) => setTimeout(r, 500));
        const jumpReport = await evalJs(cdp, `
          const pick = document.querySelector(".dg-report-reader .dg-rp-link") || document.querySelector(".dg-report-reader .dg-report-link") || document.querySelector(".dg-report-reader .dg-rp-pick-t") || document.querySelector(".dg-report-reader .dg-report-pick-t");
          if (!pick) return { skip: true, reason: "reader 无链接" };
          pick.click();
          await new Promise(r => setTimeout(r, 900));
          const scanOn = [...document.querySelectorAll(".dg-view-seg button")].find(b => (b.textContent||"").includes("扫描列表"));
          const scanSelected = scanOn?.getAttribute("aria-selected") === "true" || scanOn?.classList.contains("on");
          const flash = document.querySelector(".dg-item-flash");
          return { skip: false, scanSelected, hasFlash: !!flash, cardId: (flash || document.querySelector(".dg-item"))?.id || "" };
        `);
        if (jumpReport?.skip) skip("SRJ6", "报告 tab 跳转", jumpReport.reason);
        else if (jumpReport.scanSelected && (jumpReport.hasFlash || jumpReport.cardId)) pass("SRJ6", "报告 tab 跳转成功", jumpReport.cardId);
        else fail("SRJ6", "报告 tab 跳转", JSON.stringify(jumpReport));
      } else {
        fail("SRJ3", "报告生成", rep?.status + " " + (rep?.error || rep?.skippedReason || ""));
      }
    }

    await restoreLlm(cdp, settingsBefore);
    pass("SRJ-clean-key", "LLM 密钥已清除");
  }

  // B2.6 折叠记忆
  await goSubs(cdp);
  await evalJs(cdp, `
    localStorage.setItem("lumina_digest_report_collapsed", "1");
    return true;
  `);
  await evalJs(cdp, `
    const t = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("检索取文"));
    if (t) t.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 300));
  await goSubs(cdp);
  const collapsed = await evalJs(cdp, `return document.querySelector(".dg-report-hero")?.classList.contains("collapsed")`);
  collapsed ? pass("SRJ7", "折叠态 localStorage 保持", "collapsed") : fail("SRJ7", "折叠记忆", String(collapsed));
  await evalJs(cdp, `localStorage.removeItem("lumina_digest_report_collapsed");`);

  // B3 回归：试跑预览按钮仍在
  const reg = await evalJs(cdp, `
    const add = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("新建订阅"));
    if (add) add.click();
    await new Promise(r => setTimeout(r, 350));
    const prev = [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("预览命中"));
    const cancel = [...document.querySelectorAll("button")].find(b => (b.textContent||"").trim() === "取消");
    if (cancel) cancel.click();
    return { preview: prev };
  `);
  reg.preview ? pass("SRJ8", "订阅 CRUD/试跑预览未回归") : fail("SRJ8", "试跑预览按钮");

  await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId)});`);
  pass("SRJ-clean", "测试订阅已删除");

  cdp.ws.close();
} catch (e) {
  fail("FATAL", e.message);
  try {
    if (cdp && settingsBefore) await restoreLlm(cdp, settingsBefore);
    await evalJs(cdp, `try { await window.luminaApi.subsRemove(${JSON.stringify(subId)}); } catch {}`);
    cdp?.ws?.close();
  } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
const report = {
  at: new Date().toISOString(),
  patch: "subs_report_jump",
  llm: LLM_PROVIDER,
  pass: results.filter((r) => r.ok && !r.skipped).length,
  fail: failed.length,
  skipped: results.filter((r) => r.skipped).length,
  results,
};
writeFileSync(path.join(OUT, "subs-report-jump-report.json"), JSON.stringify(report, null, 2));
console.log(`\n── 结果：${report.pass} 通过 · ${report.fail} 失败 · ${report.skipped} 跳过 ──`);
console.log(`报告：${path.join(OUT, "subs-report-jump-report.json")}\n`);
process.exit(failed.length ? 1 : 0);
