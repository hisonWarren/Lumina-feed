#!/usr/bin/env node
/** v0.4.108：JIF 不永久卡住 — Nature 查询后 60s 内须结束「查询中」；cancelJif 可用 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9248;
const CDP = `http://127.0.0.1:${PORT}`;
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

console.log("\n── smoke-v04108-jif-unstick ──\n");
const electronBin = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
if (!existsSync(electronBin)) process.exit(1);

const child = spawn(electronBin, [".", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*"], {
  cwd: ROOT, stdio: "ignore", windowsHide: true,
});

try {
  const cdp = await cdpConnect(await waitCdp());
  await cdp.send("Runtime.enable");
  for (let i = 0; i < 60; i++) {
    if (await evalJs(cdp, `return !!document.querySelector(".lf-nav");`)) break;
    await sleep(400);
  }

  ok("cancelJif API 存在", await evalJs(cdp, `return typeof window.luminaJournal?.cancelJif === "function";`));

  const r = await evalJs(cdp, `
    const btn = [...document.querySelectorAll(".lf-nav .lf-tab")].find((b) => (b.textContent||"").includes("期刊"));
    btn.click();
    await new Promise((r)=>setTimeout(r,400));
    const input = document.querySelector(".jr-bar input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "0028-0836");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".jr-go")?.click();
    let last = "";
    let settled = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await new Promise((r)=>setTimeout(r,500));
      const heroes = [...document.querySelectorAll(".jr-hero")].map((el) => el.innerText.replace(/\\s+/g, " ").trim());
      last = heroes[0] || "";
      if (last && !/查询中|拉取中/.test(last)) { settled = true; break; }
    }
    // 若仍忙，点取消路径（IPC）
    if (!settled) {
      await window.luminaJournal.cancelJif();
      await new Promise((r)=>setTimeout(r,800));
    }
    const heroes2 = [...document.querySelectorAll(".jr-hero")].map((el) => el.innerText.replace(/\\s+/g, " ").trim());
    return {
      settled,
      jifText: heroes2[0] || last,
      hasValue: /\\d/.test(heroes2[0] || last || ""),
      name: document.querySelector(".jr-name")?.textContent || "",
      elapsedMs: Date.now() - t0,
    };
  `);

  ok("Nature 卡片命中", /nature/i.test(r?.name || ""), r);
  ok("JIF 区在 60s 内结束「查询中」或可取消恢复", !!(r && (r.settled || !/查询中/.test(r.jifText || ""))), r);
  ok("JIF 有数值或诚实空态", !!(r && (r.hasValue || /暂不可用|未收录|去添加/.test(r.jifText || ""))), r);
  console.log("  · result", JSON.stringify(r));
} catch (e) {
  console.error("SMOKE ERROR", e);
  failed++;
} finally {
  try { child.kill(); } catch { /* */ }
}
console.log(failed ? `\nFAILED (${failed})` : "\nPASSED");
process.exit(failed ? 1 : 0);
