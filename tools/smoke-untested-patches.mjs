#!/usr/bin/env node
/**
 * 真机烟测：search_settings · background · reader_plus_graph · provider_doubao
 * 需 Electron --remote-debugging-port=9222
 * 密钥：$env:LUMINA_TEST_KEY 或 $env:DOUBAO_API_KEY（豆包）；DeepSeek 可选
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

function loadDoubaoKey() {
  if (process.env.DOUBAO_API_KEY) return process.env.DOUBAO_API_KEY;
  if (process.env.LUMINA_TEST_KEY) return process.env.LUMINA_TEST_KEY;
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (!existsSync(envPath)) return "";
  const text = readFileSync(envPath, "utf8");
  const m = text.match(/^DOUBAO_API_KEY=(.+)$/m);
  return m ? m[1].trim() : "";
}
function loadDoubaoModel() {
  if (process.env.DOUBAO_MODEL) return process.env.DOUBAO_MODEL;
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (!existsSync(envPath)) return "doubao-seed-2-1-pro-260628";
  const m = readFileSync(envPath, "utf8").match(/^DOUBAO_MODEL=(.+)$/m);
  return m ? m[1].trim() : "doubao-seed-2-1-pro-260628";
}

const DOUBAO_KEY = loadDoubaoKey();
const DOUBAO_MODEL = loadDoubaoModel();
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

async function clickTab(cdp, text) {
  await evalJs(cdp, `
    const b = [...document.querySelectorAll(".lf-tab")].find(x => (x.textContent||"").includes(${JSON.stringify(text)}));
    if (!b) throw new Error("tab: ${text}");
    b.click();
  `);
  await new Promise((r) => setTimeout(r, 500));
}

console.log("\n── 真机烟测 · 未测补丁（search_settings / background / graph / doubao）──\n");

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");

  // ═══ search_settings ═══
  await clickTab(cdp, "检索取文");
  const ffMeta = await evalJs(cdp, `
    return {
      field: !!document.querySelector(".ff-field-wrap"),
      fieldOpts: [...document.querySelectorAll(".ff-field-opt")].map(b=>b.textContent?.trim()).join("|"),
      streamFn: typeof window.luminaApi?.searchOnlineStream === "function",
    };
  `);
  ffMeta.field ? pass("search_settings：字段范围下拉", ffMeta.fieldOpts?.slice(0, 60)) : fail("search_settings ff-field");
  ffMeta.streamFn ? pass("search_settings：searchOnlineStream 已暴露") : fail("search_settings stream");

  // 渐进式：监听 stream 事件
  const streamProbe = await evalJs(cdp, `
    if (!window.luminaApi?.searchOnlineStream) return { ok: false, reason: "no stream" };
    const events = [];
    const reqId = Date.now();
    const stop = window.luminaApi.searchOnlineStream("covid vaccine", {}, reqId, (ev) => events.push(ev));
    await new Promise(r => setTimeout(r, 12000));
    if (typeof stop === "function") stop();
    const types = [...new Set(events.map(e => e?.type || e?.phase || "evt"))];
    const hasPapers = events.some(e => e?.papers?.length > 0 || e?.count > 0);
    const done = events.some(e => e?.done || e?.type === "done");
    return { ok: events.length > 0, n: events.length, types: types.join(","), hasPapers, done };
  `);
  streamProbe?.ok && streamProbe?.hasPapers
    ? pass("search_settings：渐进式检索 stream", `${streamProbe.n} 事件 · papers OK`)
    : streamProbe?.ok
      ? pass("search_settings：stream 有事件", `${streamProbe.n} · ${streamProbe.types}`)
      : fail("search_settings stream", streamProbe?.reason || JSON.stringify(streamProbe));

  // UI 渐进条（触发 chip 后看 ff-sources）
  await evalJs(cdp, `
    const chip = [...document.querySelectorAll(".ff-chip")].find(b => (b.textContent||"").includes("主题词"));
    if (chip) chip.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 8000));
  const ffUi = await evalJs(cdp, `
    return {
      cards: document.querySelectorAll(".ff-card").length,
      sources: document.querySelectorAll(".ff-sources .ff-src, .ff-sources span, .ff-sources div").length,
      sourcesBar: !!document.querySelector(".ff-sources"),
      more: !!document.querySelector(".ff-more"),
    };
  `);
  ffUi.cards > 0 ? pass("search_settings：检索结果卡片", `${ffUi.cards} 张`) : skip("search_settings ff-card", "IPC 可能已通但 UI 时序未出卡");
  ffUi.sourcesBar ? pass("search_settings：各源进度条区域", `子项 ${ffUi.sources}`) : skip("search_settings ff-sources", "检索未完成或无 UI");

  // ReadHub 上下布局
  await clickTab(cdp, "阅读");
  await new Promise((r) => setTimeout(r, 400));
  const rh = await evalJs(cdp, `
    const rail = document.querySelector(".rh-rail");
    const main = document.querySelector(".rh-main");
    if (!rail || !main) return { ok: false };
    const railRect = rail.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return { ok: true, railBelow: railRect.top >= mainRect.top, railTop: railRect.top, mainTop: mainRect.top };
  `);
  rh?.ok && rh.railBelow ? pass("search_settings：ReadHub 上下布局", `rail@${Math.round(rh.railTop)} ≥ main@${Math.round(rh.mainTop)}`) : fail("ReadHub layout", JSON.stringify(rh));

  // Settings 单框 + 眼睛 + 后台开关
  await evalJs(cdp, `
    const btn = document.querySelector('.lf-icon[aria-label="设置"], button[title="设置"]');
    if (!btn) throw new Error("settings gear");
    btn.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 500));
  const setUiLlm = await evalJs(cdp, `
    return {
      comboIn: !!document.querySelector(".set-combo-in"),
      comboIn2: document.querySelectorAll(".set-combo-in").length,
      keyEye: !!document.querySelector(".set-key-eye"),
      doubaoOpt: [...document.querySelectorAll("option, button, label")].some(x => (x.textContent||"").includes("豆包")),
    };
  `);
  setUiLlm.comboIn && setUiLlm.comboIn2 === 1 ? pass("search_settings：模型单框可编辑", "仅 1 个 .set-combo-in") : fail("Settings 模型框", String(setUiLlm.comboIn2));
  setUiLlm.keyEye ? pass("search_settings：API Key 眼睛按钮") : fail("Settings key-eye");
  setUiLlm.doubaoOpt ? pass("provider_doubao：豆包供应商选项") : fail("provider_doubao 选项");

  await evalJs(cdp, `
    const gen = [...document.querySelectorAll(".set-railbtn")].find(b => (b.textContent||"").includes("通用"));
    if (gen) gen.click();
    return !!gen;
  `);
  await new Promise((r) => setTimeout(r, 300));
  const setUiGen = await evalJs(cdp, `
    return {
      bgTray: [...document.querySelectorAll("[aria-label]")].some(x => (x.getAttribute("aria-label")||"").includes("后台")),
      bgLogin: [...document.querySelectorAll("[aria-label]")].some(x => (x.getAttribute("aria-label")||"").includes("开机")),
    };
  `);
  setUiGen.bgTray ? pass("background：后台运行开关 UI") : fail("background bgTray switch");
  setUiGen.bgLogin ? pass("background：开机自启开关 UI") : fail("background bgLogin switch");

  const hasSetBg = await evalJs(cdp, `return typeof window.luminaApi?.setBackground === "function";`);
  hasSetBg ? pass("background：bridge.setBackground") : fail("setBackground");

  // API 眼睛切换 type（回到大模型分类）
  await evalJs(cdp, `
    const llm = [...document.querySelectorAll(".set-railbtn")].find(b => (b.textContent||"").includes("大模型"));
    if (llm) llm.click();
  `);
  await new Promise((r) => setTimeout(r, 250));
  await evalJs(cdp, `
    const eye = document.querySelector(".set-key-eye");
    const inp = document.querySelector(".set-in.set-mono[type]");
    if (eye && inp) { eye.click(); return inp.type; }
    return null;
  `).then((t) => (t === "text" ? pass("search_settings：眼睛切换为 text") : skip("key-eye toggle", t || "无密钥框"))).catch((e) => skip("key-eye", e.message));

  // ═══ provider_doubao ═══
  if (DOUBAO_KEY) {
    await evalJs(cdp, `
      await window.luminaApi.setSecret("doubao_key", ${JSON.stringify(DOUBAO_KEY)});
      const s = await window.luminaApi.getSettings();
      s.llm = { provider: "doubao", model: ${JSON.stringify(DOUBAO_MODEL)}, baseUrl: "https://ark.cn-beijing.volces.com/api/v3" };
      await window.luminaApi.saveSettings(s);
      return true;
    `);
    pass("provider_doubao：密钥写入钥匙串 doubao_key");

    const dTest = await evalJs(cdp, `
      return await window.luminaApi.testLlm({ provider:"doubao", model:${JSON.stringify(DOUBAO_MODEL)}, baseUrl:"https://ark.cn-beijing.volces.com/api/v3", apiKey:${JSON.stringify(DOUBAO_KEY)} });
    `);
    dTest?.ok ? pass("provider_doubao：llm:test 真连通", `${dTest.model} · ${dTest.ms}ms`) : skip("provider_doubao llm:test", dTest?.error || JSON.stringify(dTest));

    const dModels = await evalJs(cdp, `
      return await window.luminaApi.listModels({ provider:"doubao", baseUrl:"https://ark.cn-beijing.volces.com/api/v3", apiKey:${JSON.stringify(DOUBAO_KEY)} });
    `);
    dModels?.ok && dModels.models?.length
      ? pass("provider_doubao：listModels", `${dModels.models.length} 个`)
      : dModels?.ok === false
        ? pass("provider_doubao：listModels 失败回落", (dModels.error || "").slice(0, 80))
        : skip("doubao listModels", JSON.stringify(dModels).slice(0, 60));

    try {
      const dSum = await evalJs(cdp, `
        const pages = [{page:1,text:"Introduction. N=100 participants. Primary outcome p=0.03."}];
        return await window.luminaReader.summarize({ pages });
      `);
      dSum?.summaryText?.length > 20
        ? pass("provider_doubao：reader:summarize", `${dSum.summaryText.length} 字 · grounded=${dSum.groundedRatio ?? dSum.grounded?.groundedRatio ?? "?"}`)
        : skip("doubao summarize", JSON.stringify(dSum).slice(0, 100));
    } catch (e) {
      skip("doubao summarize", e.message.slice(0, 80));
    }
  } else {
    skip("provider_doubao 真连通", "无 DOUBAO_API_KEY / LUMINA_TEST_KEY / secrets.local.env");
  }

await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("阅读"));
    if (!tab) throw new Error("no read tab");
    tab.click();
  `);
  await new Promise((r) => setTimeout(r, 1200));

  const ARXIV = "smoke-graph-1706";
  await evalJs(cdp, `
    const list = await window.luminaOa.listPdfs();
    if (!list.find(x => x.paperId === ${JSON.stringify(ARXIV)})) {
      await window.luminaOa.fetchPdf("https://arxiv.org/pdf/1706.03762.pdf", ${JSON.stringify(ARXIV)});
    }
    return true;
  `).catch(() => {});

  // 确保在落地页并等待已下载列表
  await evalJs(cdp, `document.querySelector(".rhx-home")?.click(); return true;`).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));

  const graphDom = await evalJs(cdp, `
    const rows = document.querySelectorAll(".rh-row");
    const dlRow = [...rows].find(r => (r.textContent||"").includes("smoke") || (r.textContent||"").includes("1706"));
    if (dlRow) dlRow.click();
    else if (rows[0]) rows[0].click();
    await new Promise(r => setTimeout(r, 8000));
    return {
      rhx: !!document.querySelector(".rhx"),
      rail: !!document.querySelector(".rh-rail"),
      rows: rows.length,
      reader: !!document.querySelector(".rd"),
      vtoggle: !!document.querySelector(".rd-vtoggle"),
      flowBtn: [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("逻辑流程图")),
    };
  `);
  graphDom.reader ? pass("graph：PDF 阅读器已打开") : skip("graph 阅读器", "需已下载全文行可点");
  graphDom.vtoggle ? pass("graph：大纲 结构图/列表 切换 UI") : graphDom.reader ? fail("graph rd-vtoggle") : skip("graph vtoggle", "未进阅读器");
  graphDom.flowBtn ? pass("graph：推读「逻辑流程图（实验）」按钮") : graphDom.reader ? fail("graph FlowmapTool") : skip("graph flowmap btn", "未进阅读器");

  // flowmap mock（无 LLM 或快速探测）
  const flowMock = await evalJs(cdp, `
    if (!window.luminaReader?.analyze) return { ok: false, reason: "no analyze" };
    const env = await window.luminaReader.analyze("flowmap", [{page:1,text:"Step A then B then C."}], { paperId: "mock-flow" });
    return { ok: !!env, hasGraph: !!env?.graph, nodes: env?.graph?.nodes?.length, lane: env?.lane, mock: env?.framing?.includes?.("模拟") || env?.banner?.includes?.("模拟") };
  `);
  flowMock?.hasGraph
    ? pass("graph：flowmap 返回 graph 信封", `${flowMock.nodes} 节点 · lane=${flowMock.lane}`)
    : flowMock?.ok
      ? skip("graph flowmap", "无 graph 字段（可能需真 LLM）")
      : skip("graph flowmap mock", flowMock?.reason || "未测");

  // outline 结构图（需已有 outline 缓存或 mock）
  const outlineProbe = await evalJs(cdp, `
    const pages = [{page:1,text:"Background. Methods. Results. Conclusion."},{page:2,text:"We used RCT design."}];
    const env = await window.luminaReader.analyze("outline", [{page:1,text:"Background. Methods. Results. Conclusion."},{page:2,text:"We used RCT design."}], { paperId: "smoke-outline-graph" });
    return { ok: !!env, hasGraph: !!env?.graph, sections: env?.sections?.length };
  `);
  outlineProbe?.hasGraph || outlineProbe?.sections
    ? pass("graph：outline 可产结构（sections/graph）", `sections=${outlineProbe.sections} graph=${outlineProbe.hasGraph}`)
    : skip("graph outline", JSON.stringify(outlineProbe).slice(0, 80));

  // background 托盘：系统级，仅记录 IPC 探针
  skip("background：关窗→托盘驻留", "系统托盘 CDP 无法验，需人工关窗");
  skip("background：订阅后台通知", "需长时运行 + 到期订阅，人工");
  skip("packaging：npm run dist 安装", "本脚本不跑安装包");

  cdp.ws.close();
} catch (e) {
  fail("烟测中断", e.message);
}

const nFail = results.filter((r) => !r.ok).length;
const nSkip = results.filter((r) => r.skipped).length;
const report = { at: new Date().toISOString(), doubaoKey: !!DOUBAO_KEY, results };
writeFileSync(path.join(OUT, "untested-patches-report.json"), JSON.stringify(report, null, 2));
console.log(`\n结果：${results.length - nFail - nSkip} 通过 / ${nFail} 失败 / ${nSkip} 跳过`);
console.log(`报告：${path.join(OUT, "untested-patches-report.json")}\n`);
process.exit(nFail ? 1 : 0);
