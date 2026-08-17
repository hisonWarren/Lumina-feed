#!/usr/bin/env node
/** v0.4.109：Nature JIF 应优先来自 LetPub（源名含 LetPub），无需 WOS */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9257;
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
  if (exceptionDetails) {
    const desc = exceptionDetails.exception?.description || exceptionDetails.text || JSON.stringify(exceptionDetails);
    throw new Error(desc);
  }
  return result?.value;
}

for (const name of ["Lumina Feed", "Lumina Feed Dev"]) {
  const livePath = path.join(process.env.APPDATA || "", name, "journal-data", "jif-live.json");
  if (existsSync(livePath)) {
    try { unlinkSync(livePath); console.log("  · cleared", livePath); } catch { /* */ }
  }
}

console.log("\n── smoke-v04109-letpub-if ──\n");
const electronBin = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const child = spawn(electronBin, [".", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*"], {
  cwd: ROOT, stdio: "ignore", windowsHide: true,
});

try {
  const cdp = await cdpConnect(await waitCdp());
  await cdp.send("Runtime.enable");
  for (let i = 0; i < 60; i++) {
    if (await evalJs(cdp, "return !!(window.luminaJournal && document.querySelector('.lf-nav'));")) break;
    await sleep(400);
  }

  // Prefer IPC path: proves LetPub-first without fragile UI parsing
  const live = await evalJs(cdp, `
    const t0 = Date.now();
    const live = await Promise.race([
      window.luminaJournal.liveMetrics(["0028-0836"], { jif: true, cas: false, openalex: false }),
      new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 25000)),
    ]);
    return {
      liveJif: live && live.jif ? live.jif.jif : null,
      liveSrc: live && live.jif ? (live.jif.source || "") : "",
      liveHome: live && live.jif ? (live.jif.sourceHomepage || "") : "",
      live5: live && live.jif ? live.jif.jif5yr : null,
      timeout: !!(live && live.__timeout),
      elapsedMs: Date.now() - t0,
    };
  `);

  ok("JIF 有数值", live?.liveJif != null && Number(live.liveJif) > 0, live);
  ok("来源为 LetPub", /letpub/i.test(live?.liveSrc || "") || /letpub/i.test(live?.liveHome || ""), live);
  ok("未超时", !live?.timeout, live);
  console.log("  ·", JSON.stringify(live));
} catch (e) {
  console.error("SMOKE ERROR", e);
  failed++;
} finally {
  try { child.kill(); } catch { /* */ }
}
console.log(failed ? `\nFAILED (${failed})` : "\nPASSED");
process.exit(failed ? 1 : 0);
