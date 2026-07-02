#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP = "http://127.0.0.1:9230";
const PDF = process.env.LUMINA_TEST_PDF || "D:\\毕业论文\\文献PDF\\20_Papeo_2017.pdf";

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

console.log("\n── smoke-thumb-click-stability ──\n");
const child = spawn(path.join(ROOT, "node_modules/electron/dist/electron.exe"), [".", PDF, "--remote-debugging-port=9230"], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
});

let failed = 0;
try {
  const ws = await waitCdp();
  const cdp = await cdpConnect(ws);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 60; i++) {
    const ready = await evalJs(cdp, `return !!document.querySelector(".rd-view") && !document.querySelector(".rd-loading");`);
    if (ready) break;
    await sleep(400);
  }

  await evalJs(cdp, `
    const cont = [...document.querySelectorAll(".rd-views button")].find((b) => (b.textContent || "").includes("连续"));
    if (cont && !cont.classList.contains("on")) cont.click();
    const thumbs = document.querySelector('.rd-railbtn[title*="页面"]');
    if (thumbs && !thumbs.classList.contains("on")) thumbs.click();
    await new Promise((r) => setTimeout(r, 350));
    return true;
  `);

  const s1 = await evalJs(cdp, `
    document.getElementById("rd-thumb-4")?.click();
    await new Promise((r) => setTimeout(r, 500));
    return {
      page: document.querySelector(".rd-pageind input")?.value || "",
      active: document.querySelector(".rd-thumb.active")?.id || "",
    };
  `);
  if (s1.page !== "4") {
    console.log("  ✗ 点击第4页后未到4", JSON.stringify(s1));
    failed++;
  } else {
    console.log("  ✓ 点击第4页后停在4", JSON.stringify(s1));
  }

  const s2 = await evalJs(cdp, `
    await new Promise((r) => setTimeout(r, 2000));
    return {
      page: document.querySelector(".rd-pageind input")?.value || "",
      active: document.querySelector(".rd-thumb.active")?.id || "",
    };
  `);
  if (s2.page !== "4") {
    console.log("  ✗ 2秒后回跳", JSON.stringify(s2));
    failed++;
  } else {
    console.log("  ✓ 2秒后仍在4", JSON.stringify(s2));
  }

  const s3 = await evalJs(cdp, `
    const v = document.querySelector(".rd-view");
    if (v) {
      v.scrollTop += 1200;
      v.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 500));
    return {
      page: document.querySelector(".rd-pageind input")?.value || "",
      active: document.querySelector(".rd-thumb.active")?.id || "",
      scrollTop: v?.scrollTop || 0,
    };
  `);
  if (s3.page === "1" || s3.active === "rd-thumb-1") {
    console.log("  ✗ 滚动后错误回到第一页", JSON.stringify(s3));
    failed++;
  } else {
    console.log("  ✓ 滚动后非第一页", JSON.stringify(s3));
  }
  cdp.ws.close();
} catch (e) {
  console.log("  ✗", e.message);
  failed++;
} finally {
  try { child.kill(); } catch { /* ignore */ }
}
console.log(failed ? `\n  FAIL ${failed}` : "\n  PASS");
console.log("\n── done ──\n");
process.exit(failed ? 1 : 0);
