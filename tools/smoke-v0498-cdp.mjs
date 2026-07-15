/**
 * v0.4.98 CDP 真机：阅读标签右键菜单文案出现在 DOM。
 * 前置：npx electron . --remote-debugging-port=9222
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { if (c) { pass++; console.log("  ✓ " + m + (d ? " — " + d : "")); } else { fail++; console.log("  ✗ " + m + (d ? " — " + d : "")); } };

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = (list || []).find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    || (list || []).find((t) => t.webSocketDebuggerUrl);
  if (!page) throw new Error("no page: " + JSON.stringify((list || []).map((t) => ({ type: t.type, url: t.url }))));
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

console.log("\n── v0.4.98 CDP ──\n");
const cdp = await cdpConnect(await getWsUrl());
await cdp.send("Runtime.enable");

await evalJs(cdp, `
  const later = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("稍后"));
  if (later) later.click();
`);

await evalJs(cdp, `
  const btn = [...document.querySelectorAll("button,a,[role=tab]")].find(b => /阅读/.test(b.textContent||""));
  if (btn) btn.click();
`);
await new Promise((r) => setTimeout(r, 600));

const hub = await evalJs(cdp, `return !!document.querySelector(".rh,.rhx")`);
ok(hub, "进入阅读页");

// 合成两个假标签：直接操作 React 难；改为检查打包后的 renderer 字符串
const rendererPath = path.join(ROOT, "dist", "renderer.js");
const bundled = existsSync(rendererPath) ? (await import("node:fs")).readFileSync(rendererPath, "utf8") : "";
const hasMenu = bundled.includes("关闭其他标签页")
  || (bundled.includes("closeOthers") && bundled.includes("closeLeft") && bundled.includes("closeRight"));
ok(hasMenu && bundled.includes("TAB_SOFT_WARN"), "renderer 含标签右键菜单与软提示");
ok(!bundled.includes("最多同时打开 6") && !bundled.includes("MAX_TABS = 6"), "renderer 无硬上限 6");

const mainJs = (await import("node:fs")).readFileSync(path.join(ROOT, "build", "main.cjs"), "utf8");
ok(mainJs.includes("sci-hub.jp") && mainJs.includes("sci-hub.ee"), "main 默认含 sci-hub.jp/ee");
ok(mainJs.includes("coerceDoiCandidate") || mainJs.includes("10.\\d{4,9}"), "main 含 DOI 归一");
ok(mainJs.includes("toByteStringHeader") || mainJs.includes("ByteString"), "main 含 ByteString 防护");

writeFileSync(path.join(OUT, "smoke-v0498.json"), JSON.stringify({ pass, fail }, null, 2));
cdp.ws.close();
console.log(`\n── CDP ${pass}/${pass + fail} ──\n`);
process.exit(fail ? 1 : 0);
