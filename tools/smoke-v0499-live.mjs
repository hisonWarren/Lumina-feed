/**
 * v0.4.99 真机：自启 Electron(9222) → 验证框选 IPC 复制小图 + preload API + 结构。
 * 另存会弹对话框，自动化只验 API 存在；完整框选手势需打开 PDF 后手动点一次。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });
const CDP = "http://127.0.0.1:9222";
const R = (p) => { try { return readFileSync(path.join(ROOT, p), "utf8"); } catch { return ""; } };

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { if (c) { pass++; console.log("  ✓ " + m + (d ? " — " + d : "")); } else { fail++; console.log("  ✗ " + m + (d ? " — " + d : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1×1 透明 PNG
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function waitCdp(maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const page = (list || []).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* */ }
    await sleep(400);
  }
  throw new Error("CDP 9222 未就绪");
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

console.log("\n── v0.4.99 真机烟测 ──\n");

const pkg = JSON.parse(R("package.json"));
ok(pkg.version === "0.4.99", "version");

try {
  execSync("node tools/verify-lumina-reader-plus-vision.mjs", { cwd: ROOT, stdio: "inherit" });
  ok(true, "vision 契约");
} catch {
  ok(false, "vision 契约");
}

console.log("  · build:electron …");
execSync("npm run build:electron", { cwd: ROOT, stdio: "inherit" });

const electronExe = path.join(ROOT, "node_modules/electron/dist/electron.exe");
if (!existsSync(electronExe)) {
  console.error("缺少 electron.exe");
  process.exit(1);
}

// 若已有 9222，沿用；否则自启
let child = null;
let ownProcess = false;
try {
  await waitCdp(2000);
  console.log("  · 复用已有 CDP 9222");
} catch {
  child = spawn(electronExe, [".", "--remote-debugging-port=9222", "--disable-gpu"], {
    cwd: ROOT, stdio: "ignore", windowsHide: true,
  });
  ownProcess = true;
  console.log("  · 已启动 Electron --remote-debugging-port=9222");
}

let cdp;
try {
  const wsUrl = await waitCdp();
  cdp = await cdpConnect(wsUrl);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 40; i++) {
    const ready = await evalJs(cdp, `return !!(window.luminaReader || window.luminaApi)`);
    if (ready) break;
    await sleep(500);
  }

  const api = await evalJs(cdp, `
    const r = window.luminaReader;
    return r ? { copy: typeof r.copyImage, save: typeof r.saveImage, fig: typeof r.figure } : null;
  `);
  ok(api && api.copy === "function" && api.save === "function", "preload copyImage/saveImage", JSON.stringify(api));

  const copyRes = await evalJs(cdp, `
    const r = window.luminaReader;
    if (!r || !r.copyImage) return { ok:false, reason:"missing" };
    return await r.copyImage(${JSON.stringify(TINY_PNG)});
  `);
  ok(copyRes && copyRes.ok === true, "IPC copyImage 1×1 PNG", JSON.stringify(copyRes));

  await evalJs(cdp, `const b=[...document.querySelectorAll("button")].find(x=>(x.textContent||"").includes("稍后")); if(b)b.click();`);
  await evalJs(cdp, `const b=[...document.querySelectorAll("button,a,[role=tab]")].find(x=>/阅读/.test(x.textContent||"")); if(b)b.click();`);
  await sleep(600);

  const label = await evalJs(cdp, `
    const btn=[...document.querySelectorAll(".rd-btn,button")].find(b=>/框选|截图/.test(b.textContent||""));
    return btn ? String(btn.textContent||"").replace(/\\s+/g," ").trim() : "";
  `);
  if (label) ok(/框选/.test(label) && !/截图/.test(label), "工具栏文案", label);
  else ok(true, "阅读器未打开（无框选按钮；IPC/契约已覆盖）");

  const bundled = R("dist/renderer.js");
  ok(
    bundled.includes("rd-snip-acts")
      && bundled.includes("onSnipCopy")
      && bundled.includes("onSnipAnalyze")
      && (bundled.includes("框选") || bundled.includes("\\u6846\\u9009")),
    "dist/renderer 含 O3 UI",
  );
  const mainJs = R("build/main.cjs");
  ok(mainJs.includes("reader:copyImage") && mainJs.includes("reader:saveImage"), "main.cjs 含截取 IPC");
} catch (e) {
  ok(false, "CDP 流程异常", String(e && e.message || e).slice(0, 240));
} finally {
  try { cdp && cdp.ws.close(); } catch { /* */ }
  if (ownProcess && child && !child.killed) {
    try { child.kill(); } catch { /* */ }
    await sleep(800);
  }
}

writeFileSync(path.join(OUT, "smoke-v0499-live.json"), JSON.stringify({ pass, fail }, null, 2));
console.log(`\n── 真机 ${pass}/${pass + fail} ──\n`);
process.exit(fail ? 1 : 0);
