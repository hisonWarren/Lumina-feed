#!/usr/bin/env node
/**
 * 真机烟测：订阅计数统一 + 删除确认 + DeepSeek 今日报告质量
 * 用法：先 npm run build:electron，本脚本自启 Electron CDP。
 * 密钥：LUMINA_TEST_KEY / DEEPSEEK_API_KEY（勿写入仓库）
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9236;
const CDP = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const API_KEY = (process.env.LUMINA_TEST_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
const MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

let failed = 0;
const ok = (n, c, d = "") => { if (c) console.log("  ✓", n, d ? "— " + d : ""); else { console.log("  ✗", n, d); failed++; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitCdp(ms = 60000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      last = String(list.length);
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || "")) || list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { last = String(e.message || e); }
    await sleep(400);
  }
  throw new Error("CDP timeout: " + last);
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

console.log("\n── smoke-subs-count-report ──\n");

// 离线单元：计数口径
const unreadMod = await import(pathToFileURL(path.join(ROOT, "src/ui/lib/subs-unread.js")).href);
{
  const sub = {
    id: "u", enabled: true, hideNoAbstract: true, readIds: [],
    today: [
      { id: "1", abstract: "y".repeat(50) },
      { id: "2", abstract: "" },
      { id: "3", abstract: "", doi: "10.x/y" },
      { id: "4", abstract: "z".repeat(50) },
    ],
  };
  ok("离线 hideNoAbstract 计数", unreadMod.unreadTodayCount(sub) === 3, String(unreadMod.unreadTodayCount(sub)));
}

if (!API_KEY) {
  console.log("  ○ 无 API Key — 跳过 DeepSeek 真机段（结构/离线已测）");
  process.exit(failed ? 1 : 0);
}

const electronBin = path.join(ROOT, "node_modules/electron/dist/electron.exe");
if (!existsSync(electronBin)) {
  console.error("electron.exe missing");
  process.exit(2);
}

const child = spawn(electronBin, [`--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", "."], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let elog = "";
child.stderr?.on("data", (d) => { elog += String(d); });
child.stdout?.on("data", (d) => { elog += String(d); });

const subId = "smoke_count_" + Date.now();
let cdp;
try {
  cdp = await cdpConnect(await waitCdp());
  await cdp.send("Runtime.enable");
  for (let i = 0; i < 80; i++) {
    const ready = await evalJs(cdp, `return !!(window.luminaApi && document.querySelector(".lf-nav"));`);
    if (ready) break;
    await sleep(400);
  }

  await evalJs(cdp, `
    await window.luminaApi.setSecret("deepseek_key", ${JSON.stringify(API_KEY)});
    const s = await window.luminaApi.getSettings();
    await window.luminaApi.saveSettings({
      ...s,
      digestReportAuto: true,
      llm: { provider: "deepseek", model: ${JSON.stringify(MODEL)}, baseUrl: "https://api.deepseek.com" },
    });
    return true;
  `);
  ok("DeepSeek 已配置", true, MODEL);

  // 构造：hideNoAbstract=true，today 含 2 条有摘要 + 若干无摘要 → UI/报告都应只认 2
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const draft = {
    id: subId,
    name: "smoke neuroimaging count",
    kind: "keyword",
    q: "neuroimaging schizophrenia",
    freq: "daily",
    time: "08:00",
    autoSummarize: "off",
    hideNoAbstract: true,
    enabled: true,
    seenIds: [],
    readIds: [],
    todayDateKey: todayKey,
    today: [
      { id: subId + "_p1", title: "Paper with abstract A on dopamine imaging", abstract: "Functional MRI study of dopamine pathways in schizophrenia patients with detailed methods and results. ".repeat(2), year: 2026 },
      { id: subId + "_p2", title: "Paper with abstract B on white matter", abstract: "Diffusion tensor imaging reveals white matter alterations linked to cognitive deficits in psychosis. ".repeat(2), year: 2026 },
      { id: subId + "_p3", title: "No abstract junk hit", abstract: "", year: 2026 },
      { id: subId + "_p4", title: "Another empty abstract", abstract: "hi", year: 2026 },
    ],
  };
  await evalJs(cdp, `await window.luminaApi.subsSave(${JSON.stringify(draft)});`);

  const listed = await evalJs(cdp, `
    const list = await window.luminaApi.subsList();
    const s = list.find(x => x.id === ${JSON.stringify(subId)});
    return { todayLen: (s?.today||[]).length, hide: !!s?.hideNoAbstract, todayDateKey: s?.todayDateKey };
  `);
  ok("订阅已写入", listed?.todayLen === 4, JSON.stringify(listed));

  // 切到订阅页并点开该订阅
  await evalJs(cdp, `
    const btn = [...document.querySelectorAll(".lf-nav .lf-tab")].find(b => (b.textContent||"").includes("订阅"));
    btn && btn.click();
    await new Promise(r => setTimeout(r, 600));
    return !!document.querySelector(".subs");
  `);

  // 通过 bridge 生成单订阅报告，断言 paperCount/unreadCount=2，brief 不含「48」类串数
  const gen = await evalJs(cdp, `
    const r = await window.luminaApi.digestReportGenerate({ scope: ${JSON.stringify(subId)}, force: true });
    return r;
  `);
  const report = gen?.report || gen;
  console.log("  report →", {
    ok: gen?.ok,
    status: report?.status,
    unreadCount: report?.unreadCount,
    paperCount: report?.paperCount,
    briefLen: (report?.brief || "").length,
    highlights: (report?.highlights || []).length,
  });
  ok("单订阅报告 ready", report?.status === "ready", report?.status || report?.error || report?.skippedReason);
  ok("unreadCount=2（对齐 hideNoAbstract）", report?.unreadCount === 2, String(report?.unreadCount));
  ok("paperCount≤2", (report?.paperCount || 0) <= 2 && (report?.paperCount || 0) >= 1, String(report?.paperCount));
  const brief = String(report?.brief || "");
  ok("brief 足够长（非一句空话）", brief.length >= 80, `len=${brief.length}`);
  ok("brief 未串写成大篇数", !/今日\s*4[0-9]\s*篇|今日48篇|今日50篇/.test(brief), brief.slice(0, 80));
  ok("有 highlights 要点", Array.isArray(report?.highlights) && report.highlights.length >= 2, String(report?.highlights?.length));

  // UI：打开删除确认
  const delUi = await evalJs(cdp, `
    const item = [...document.querySelectorAll(".subitem")].find(el => (el.textContent||"").includes("smoke neuroimaging"));
    if (!item) return { ok:false, reason:"no_item" };
    item.click();
    await new Promise(r => setTimeout(r, 200));
    const trash = item.querySelector(".subctl button[title='删除']");
    if (!trash) return { ok:false, reason:"no_trash" };
    trash.click();
    await new Promise(r => setTimeout(r, 200));
    const dlg = document.querySelector(".sub-confirm");
    const text = dlg ? dlg.textContent : "";
    // 取消，不真删（后面 API 清）
    const cancel = dlg && [...dlg.querySelectorAll("button")].find(b => (b.textContent||"").includes("取消"));
    cancel && cancel.click();
    return { ok: !!dlg, text: (text||"").slice(0, 120) };
  `);
  ok("删除弹出确认框", !!delUi?.ok, JSON.stringify(delUi));
  ok("确认框提到保留历史", /历史|保留/.test(delUi?.text || ""), delUi?.text || "");

  await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId)});`);
  ok("清理测试订阅", true);

  cdp.ws.close();
} catch (e) {
  console.error("  烟测异常:", e.message);
  if (elog) console.error("  electron:\n" + elog.slice(-1500));
  failed++;
  try { if (cdp) await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId)});`); } catch { /* ignore */ }
  try { cdp?.ws?.close(); } catch { /* ignore */ }
} finally {
  try { child.kill(); } catch { /* ignore */ }
}

writeFileSync(path.join(OUT, "subs-count-report.json"), JSON.stringify({ at: new Date().toISOString(), failed }, null, 2));
console.log("\n──────────────────────────────");
console.log(failed ? `smoke-subs-count-report：失败 ${failed}` : "smoke-subs-count-report：通过");
process.exit(failed ? 1 : 0);
