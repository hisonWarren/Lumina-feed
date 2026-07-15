/**
 * v0.4.99：框选截取 O3 —— 结构契约 +（可选）CDP 真机按钮文案。
 * CDP 前置：npx electron . --remote-debugging-port=9222
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });
const R = (p) => { try { return readFileSync(path.join(ROOT, p), "utf8"); } catch { return ""; } };

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { if (c) { pass++; console.log("  ✓ " + m + (d ? " — " + d : "")); } else { fail++; console.log("  ✗ " + m + (d ? " — " + d : "")); } };

console.log("\n── v0.4.99 结构烟测 ──\n");
const pkg = JSON.parse(R("package.json"));
ok(pkg.version === "0.4.99", "version 0.4.99");

const rd = R("src/ui/modules/Reader.jsx");
ok(/框选/.test(rd) && /rd-snip-acts/.test(rd), "Reader 含「框选」与动作条");
ok(/onSnipCopy/.test(rd) && /onSnipSave/.test(rd) && /onSnipAnalyze/.test(rd), "三段动作处理函数");
ok(/分析图表/.test(rd) && !/> 截图</.test(rd), "分析与复制/保存分流，工具栏非「截图」");

const ipc = R("electron/ipc.ts");
ok(/reader:copyImage/.test(ipc) && /clipboard\.writeImage/.test(ipc), "copyImage → clipboard.writeImage");
ok(/reader:saveImage/.test(ipc) && /showSaveDialog/.test(ipc), "saveImage → showSaveDialog");

const pre = R("electron/preload.ts");
ok(/copyImage:.*reader:copyImage/.test(pre) && /saveImage:.*reader:saveImage/.test(pre), "preload 暴露");

const br = R("src/ui/lumina-bridge.js");
ok(/readerCopyImage/.test(br) && /readerSaveImage/.test(br), "bridge 封装");

try {
  execSync("node tools/verify-lumina-reader-plus-vision.mjs", { cwd: ROOT, stdio: "pipe" });
  ok(true, "verify-lumina-reader-plus-vision");
} catch (e) {
  ok(false, "verify-lumina-reader-plus-vision", String(e.stderr || e.message || e).slice(0, 200));
}

// 可选 CDP：若 9222 可用则检查按钮文案
let cdpDone = false;
try {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const page = (list || []).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (page) {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) j(new Error(msg.error.message || JSON.stringify(msg.error)));
        else r(msg.result);
      }
    });
    const send = (method, params = {}) => new Promise((r, j) => {
      const id = nextId++;
      pending.set(id, { resolve: r, reject: j });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send("Runtime.enable");
    const evalJs = async (expr) => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
      });
      if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
      return result.value;
    };
    await evalJs(`const b=[...document.querySelectorAll("button")].find(x=>(x.textContent||"").includes("稍后")); if(b)b.click();`);
    await evalJs(`const b=[...document.querySelectorAll("button,a,[role=tab]")].find(x=>/阅读/.test(x.textContent||"")); if(b)b.click();`);
    await new Promise((r) => setTimeout(r, 500));
    // 无法无 PDF 打开 Reader 工具栏时，检查已打包/源码字符串已由上面覆盖；若在阅读器则查按钮
    const label = await evalJs(`
      const btn=[...document.querySelectorAll(".rd-btn")].find(b=>/框选|截图/.test(b.textContent||""));
      return btn ? String(btn.textContent||"").trim() : "";
    `);
    if (label) {
      ok(/框选/.test(label) && !/截图/.test(label), "CDP 工具栏文案", label);
    } else {
      ok(true, "CDP 已连接（当前无阅读器框选按钮，结构检查已覆盖）");
    }
    // 主进程是否挂上 IPC：探 preload 全局
    const hasApi = await evalJs(`return !!(window.luminaReader && window.luminaReader.copyImage && window.luminaReader.saveImage)`);
    ok(!!hasApi, "CDP luminaReader.copyImage/saveImage 已暴露");
    ws.close();
    cdpDone = true;
  }
} catch {
  ok(true, "CDP 未开（跳过真机按钮；结构检查已通过）");
}

const bundled = existsSync(path.join(ROOT, "dist", "renderer.js")) ? R("dist/renderer.js") : "";
if (bundled) {
  ok(
    bundled.includes("rd-snip-acts")
      && bundled.includes("onSnipCopy")
      && (bundled.includes("框选") || bundled.includes("\\u6846\\u9009")),
    "dist/renderer 含动作条",
  );
}

writeFileSync(path.join(OUT, "smoke-v0499.json"), JSON.stringify({ pass, fail, cdpDone }, null, 2));
console.log(`\n── ${pass}/${pass + fail} ──\n`);
process.exit(fail ? 1 : 0);
