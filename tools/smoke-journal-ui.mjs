#!/usr/bin/env node
// lumina-feed · 期刊工具真机 UI 烟测（CDP）
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9232;
const CDP = `http://127.0.0.1:${PORT}`;

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitCdp(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
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
      return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
    }
  });
}

async function evalJs(cdp, expr) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

console.log("\n── smoke-journal-ui ──\n");
const child = spawn(path.join(ROOT, "node_modules/electron/dist/electron.exe"), [".", `--remote-debugging-port=${PORT}`], {
  cwd: ROOT, stdio: "ignore", windowsHide: true,
});

let failed = 0;
const ok = (name, cond, extra) => { if (cond) console.log("  ✓", name); else { console.log("  ✗", name, extra ? JSON.stringify(extra) : ""); failed++; } };

try {
  const ws = await waitCdp();
  const cdp = await cdpConnect(ws);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 60; i++) {
    const ready = await evalJs(cdp, `return !!document.querySelector(".lf-nav");`);
    if (ready) break;
    await sleep(400);
  }

  // 切到期刊 tab
  const tabbed = await evalJs(cdp, `
    const btn = [...document.querySelectorAll(".lf-nav .lf-tab")].find((b) => (b.textContent||"").includes("期刊"));
    if (!btn) return { ok:false, reason:"no_tab" };
    btn.click();
    await new Promise((r)=>setTimeout(r,400));
    return { ok: !!document.querySelector(".jr"), hasBar: !!document.querySelector(".jr-bar input"), hasDs: !!document.querySelector(".jr-ds-wrap") };
  `);
  ok("期刊 tab 打开 + 面板渲染", tabbed && tabbed.ok && tabbed.hasBar && tabbed.hasDs, tabbed);

  // ISSN 查询 Nature（live OpenAlex）
  const r1 = await evalJs(cdp, `
    const input = document.querySelector(".jr-bar input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "0028-0836");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r)=>setTimeout(r,60));
    const go = document.querySelector(".jr-go");
    go.click();
    for (let i=0;i<50;i++){ await new Promise((r)=>setTimeout(r,400)); if (document.querySelector(".jr-card") || document.querySelector(".jr-empty h3")) break; }
    const name = document.querySelector(".jr-name")?.textContent || "";
    const metricVals = [...document.querySelectorAll(".jr-metrics .jr-mv")].map((e)=>e.textContent);
    const impact = metricVals[0] || "";
    return { name, impact, metricVals, hasCard: !!document.querySelector(".jr-card") };
  `);
  ok("ISSN 查询命中期刊卡片", r1 && r1.hasCard, r1);
  ok("刊名为 Nature", r1 && /nature/i.test(r1.name), r1);
  ok("类影响因子有实时数值(非—)", r1 && r1.impact && r1.impact !== "—", r1);

  // 名称查询 PLOS ONE
  const r2 = await evalJs(cdp, `
    const input = document.querySelector(".jr-bar input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "PLOS ONE");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r)=>setTimeout(r,60));
    document.querySelector(".jr-go").click();
    for (let i=0;i<50;i++){ await new Promise((r)=>setTimeout(r,400)); if (document.querySelector(".jr-card")) break; }
    return { name: document.querySelector(".jr-name")?.textContent || "", hasCard: !!document.querySelector(".jr-card") };
  `);
  ok("名称查询 PLOS ONE 命中", r2 && r2.hasCard && /plos/i.test(r2.name), r2);

  // 预警刊：内置 CAS 2025（ISSN 0929-6212 → Wireless Personal Communications）应显示红色预警条
  const r3 = await evalJs(cdp, `
    const input = document.querySelector(".jr-bar input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "0929-6212");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r)=>setTimeout(r,60));
    document.querySelector(".jr-go").click();
    for (let i=0;i<50;i++){ await new Promise((r)=>setTimeout(r,400)); if (document.querySelector(".jr-card")) break; }
    const warn = document.querySelector(".jr-warn");
    return { hasCard: !!document.querySelector(".jr-card"), hasWarn: !!warn, isHist: warn ? warn.classList.contains("hist") : null, warnText: warn?.textContent || "" };
  `);
  ok("预警刊命中卡片", r3 && r3.hasCard, r3);
  ok("显示当前预警红条(非历史)", r3 && r3.hasWarn && r3.isHist === false, r3);
  ok("预警文案含‘预警名单’", r3 && /预警名单/.test(r3.warnText), r3);

  // 粘贴导入模态：展开数据集面板后，点「粘贴导入」应打开含 textarea 的模态
  const r4 = await evalJs(cdp, `
    const toggle = document.querySelector("#jr-ds-toggle");
    if (toggle && !document.querySelector(".jr-ds-wrap.open")) { toggle.click(); await new Promise((r)=>setTimeout(r,200)); }
    const btn = [...document.querySelectorAll(".jr-ds-wrap .jr-btn")].find((b)=>(b.textContent||"").includes("粘贴导入"));
    if (!btn) return { ok:false, reason:"no_paste_btn" };
    btn.click();
    await new Promise((r)=>setTimeout(r,300));
    const modal = document.querySelector(".jr-modal");
    const ta = document.querySelector(".jr-modal .jr-ta");
    const closed = (()=>{ const x = document.querySelector(".jr-modal-h .x"); if (x) x.click(); return true; })();
    await new Promise((r)=>setTimeout(r,200));
    return { ok: !!modal && !!ta, modalGone: !document.querySelector(".jr-modal") };
  `);
  ok("粘贴导入模态打开(含输入框)", r4 && r4.ok, r4);
  ok("模态可关闭", r4 && r4.modalGone === true, r4);

  const r5 = await evalJs(cdp, `
    const jr = document.querySelector(".jr");
    if (jr) jr.scrollTop = 0;
    const toggle = document.querySelector("#jr-ds-toggle");
    if (toggle && !document.querySelector(".jr-ds-wrap.open")) { toggle.click(); await new Promise((r)=>setTimeout(r,300)); }
    const bar = document.querySelector(".jr-bar");
    const head = document.querySelector(".jr-head");
    const ds = document.querySelector(".jr-ds-wrap.open");
    const empty = document.querySelector(".jr-empty");
    const barRect = bar?.getBoundingClientRect();
    const hostRect = jr?.getBoundingClientRect();
    const barVisible = barRect && hostRect && barRect.top >= hostRect.top - 4 && barRect.bottom <= hostRect.bottom + 4;
    return { dsOpen: !!ds, barVisible, hasEmpty: !!empty, headBeforeDs: !!(head && ds && head.compareDocumentPosition(ds) & Node.DOCUMENT_POSITION_FOLLOWING) };
  `);
  ok("展开数据集后搜索栏仍在视区内", r5 && r5.barVisible, r5);
  ok("展开数据集时隐藏空状态占位", r5 && r5.dsOpen && !r5.hasEmpty, r5);
  ok("数据集面板紧跟搜索区之后", r5 && r5.headBeforeDs, r5);

  cdp.ws.close();
} catch (e) {
  console.log("  ✗ 异常:", e.message);
  failed++;
} finally {
  try { child.kill(); } catch { /* ignore */ }
}
console.log(failed ? `\n  FAIL ${failed}` : "\n  PASS");
console.log("\n── done ──\n");
process.exit(failed ? 1 : 0);
