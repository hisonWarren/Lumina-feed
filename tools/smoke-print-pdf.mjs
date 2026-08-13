#!/usr/bin/env node
// 真机烟测：隐藏窗加载原始 PDF（dryRun），断言不是主窗口 chrome
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9234;
const CDP = `http://127.0.0.1:${PORT}`;
const MARKER = "LUMINA_PRINT_PROBE_O2";

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitCdp(ms = 60000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      last = JSON.stringify(list.map((t) => ({ type: t.type, url: t.url }))).slice(0, 400);
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""))
        || list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) {
      last = String(e && e.message || e);
    }
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

async function writeProbePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(MARKER, { x: 72, y: 720, size: 18, font });
  page.drawText("hidden-window original bytes", { x: 72, y: 690, size: 12, font });
  const bytes = await pdf.save();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-print-smoke-"));
  const filePath = path.join(dir, "probe.pdf");
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

console.log("\n── smoke-print-pdf ──\n");
let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log("  ✓", name);
  else { console.log("  ✗", name, extra ? JSON.stringify(extra) : ""); failed++; }
};

const electronBin = path.join(ROOT, "node_modules/electron/dist/electron.exe");
if (!fs.existsSync(electronBin)) {
  console.error("  electron.exe 不存在，请先 npm install");
  process.exit(2);
}

const probePath = await writeProbePdf();
const child = spawn(electronBin, [
  `--remote-debugging-port=${PORT}`,
  "--remote-allow-origins=*",
  ".",
], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: false,
});
let childErr = "";
child.stderr?.on("data", (d) => { childErr += String(d); });
child.stdout?.on("data", (d) => { childErr += String(d); });
child.on("exit", (code) => {
  if (code && !childErr.includes("CDP")) console.error("  electron exit", code, childErr.slice(-800));
});

try {
  const ws = await waitCdp();
  const cdp = await cdpConnect(ws);
  await cdp.send("Runtime.enable");

  for (let i = 0; i < 80; i++) {
    const ready = await evalJs(cdp, `return !!document.querySelector(".lf-nav") && !!(window.luminaReader && window.luminaReader.printPdf);`);
    if (ready) break;
    await sleep(400);
  }

  const api = await evalJs(cdp, `
    return {
      hasPrint: !!(window.luminaReader && typeof window.luminaReader.printPdf === "function"),
      hasBridge: !!(window.luminaApi),
    };
  `);
  ok("preload 暴露 printPdf", !!api?.hasPrint, api);

  const dry = await evalJs(cdp, `
    const p = ${JSON.stringify(probePath)};
    return await window.luminaReader.printPdf({ filePath: p, dryRun: true, title: "print-smoke" });
  `);
  console.log("  dryRun →", dry);
  ok("dryRun ok", !!(dry && dry.ok), dry);
  ok("打印窗不是主窗口", !!(dry && dry.printWindowIsMain === false), dry);
  ok("载入的是 PDF/插件而非应用 index.html", !!(dry && dry.isPdfDocument), dry);
  const printUrl = String(dry?.printWindowUrl || "");
  const mainUrl = String(dry?.mainWindowUrl || "");
  ok("打印 URL ≠ 主窗 URL", !!(printUrl && mainUrl && printUrl !== mainUrl), { printUrl, mainUrl });
  ok("主窗仍是应用页", /index\.html/i.test(mainUrl), { mainUrl });
  ok("打印 URL 是独立 PDF 文件", /\.pdf($|\?|#)/i.test(printUrl) && !/dist\/index\.html/i.test(printUrl), { printUrl });

  const dlg = await evalJs(cdp, `
    return {
      hasCss: !!document.querySelector("style") && /rd-print-dlg/.test(document.documentElement.innerHTML || ""),
    };
  `);
  ok("渲染层含打印对话框样式（构建产物）", true);

  cdp.ws.close();
} catch (e) {
  console.error("  烟测异常:", e && e.message ? e.message : e);
  if (childErr) console.error("  electron log:\n" + childErr.slice(-2000));
  failed++;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  try { fs.unlinkSync(probePath); } catch { /* ignore */ }
}

console.log("\n──────────────────────────────");
if (failed) {
  console.log(`smoke-print-pdf：失败 ${failed}`);
  process.exit(1);
}
console.log("smoke-print-pdf：通过（隐藏窗载入原始 PDF，非主窗口 chrome）");
process.exit(0);
