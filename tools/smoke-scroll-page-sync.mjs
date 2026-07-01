#!/usr/bin/env node
/** 连续模式：主视区滚动后页码/缩略图应离开第 1 页 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9224";
const PDF = process.env.LUMINA_TEST_PDF || "D:\\毕业论文\\文献PDF\\20_Papeo_2017.pdf";

async function waitCdp(ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("CDP 超时");
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

console.log("\n── smoke-scroll-page-sync ──\n");
const child = spawn(path.join(ROOT, "node_modules/electron/dist/electron.exe"), [".", PDF, "--remote-debugging-port=9224"], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
});

let exitCode = 1;
try {
  const wsUrl = await waitCdp();
  const cdp = await cdpConnect(wsUrl);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 40; i++) {
    const ready = await evalJs(cdp, `return !!document.querySelector(".rd-view") && !document.querySelector(".rd-loading");`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const st = await evalJs(cdp, `
    const view = document.querySelector(".rd-view");
    if (!view) return { ok: false, why: "no view" };
    const before = document.querySelector(".rd-pageind input")?.value;
    view.scrollTop = Math.min(view.scrollHeight * 0.55, view.scrollHeight - 200);
    view.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 250));
    const after = document.querySelector(".rd-pageind input")?.value;
    const active = document.querySelector(".rd-thumb.active")?.id;
    return { ok: true, before, after, active, scrollTop: view.scrollTop };
  `);

  if (st?.ok && st.after && st.after !== "1" && st.active && st.active !== "rd-thumb-1") {
    console.log(`  ✓ SP-1 滚动后页码 ${st.before} → ${st.after}，缩略图 ${st.active}`);
    exitCode = 0;
  } else {
    console.log("  ✗ SP-1 滚动后仍停在第 1 页", JSON.stringify(st));
  }
  cdp.ws.close();
} catch (e) {
  console.log("  ✗", e.message);
} finally {
  try { child.kill(); } catch { /* ignore */ }
}
console.log("\n── done ──\n");
process.exit(exitCode);
