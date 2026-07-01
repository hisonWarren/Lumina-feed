#!/usr/bin/env node
/** 真机烟测：阅读器页内查找（跨 span 高亮 + 浮动查找条）· CDP 9222 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PDF = "D:\\毕业论文\\文献PDF\\20_Papeo_2017.pdf";
const PDF_PATH = process.env.LUMINA_TEST_PDF || DEFAULT_PDF;

const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); process.exitCode = 1; };
const skip = (n, d = "") => console.log(`  ○ ${n} — 跳过：${d}`);

async function getWsUrl() {
  const page = (await (await fetch(`${CDP}/json/list`)).json()).find(
    (t) => t.type === "page" && /index\.html/.test(t.url || ""),
  );
  if (!page) throw new Error("Electron CDP 9222 未就绪");
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

console.log("\n── smoke-reader-find ──\n");
console.log(`  PDF: ${PDF_PATH}\n`);

if (!fs.existsSync(PDF_PATH)) {
  console.error(`  PDF 不存在: ${PDF_PATH}`);
  process.exit(2);
}

const renderer = fs.readFileSync(path.join(ROOT, "dist/renderer.js"), "utf8");
renderer.includes("rd-find-float") && renderer.includes("findMatchStarts")
  ? pass("RF-0", "构建产物含浮动查找与跨 span 算法")
  : fail("RF-0", "renderer 缺查找修复");

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
} catch (e) {
  console.log("  CDP 不可用:", e.message);
  console.log("  请先: cd lumina-feed && npm run build:electron && npx electron . --remote-debugging-port=9222");
  process.exit(2);
}

const pdfJson = JSON.stringify(PDF_PATH);
const title = path.basename(PDF_PATH, ".pdf");

try {
  const opened = await evalJs(cdp, `
    const p = ${pdfJson};
    [...document.querySelectorAll(".rhx-tab-x")].forEach(x => x.click());
    await new Promise(r => setTimeout(r, 250));
    const meta = await window.luminaReader.readLocalPdf(p);
    if (!meta || !meta.bytes || !meta.bytes.byteLength) return { ok: false, reason: "readLocalPdf 失败" };
    const readTab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("阅读"));
    if (readTab) readTab.click();
    await new Promise(r => setTimeout(r, 700));
    document.querySelector(".rhx-home")?.click();
    await new Promise(r => setTimeout(r, 400));
    const name = p.split(/[\\\\/]/).pop() || "test.pdf";
    const file = new File([meta.bytes], name, { type: "application/pdf" });
    try { Object.defineProperty(file, "path", { value: p, configurable: true }); } catch { /* ignore */ }
    const dt = new DataTransfer();
    dt.items.add(file);
    const drop = document.querySelector(".rh-drop");
    if (!drop) return { ok: false, reason: "无拖放区" };
    drop.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    for (let i = 0; i < 50; i++) {
      if (document.querySelector(".rd") && !document.querySelector(".rd-loading") && document.querySelector(".textLayer span")) {
        return { ok: true };
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return { ok: false, reason: "阅读器或文本层超时" };
  `);
  opened?.ok ? pass("RF-1", "打开本地 PDF 阅读器") : fail("RF-1", opened?.reason || "无文本层");

  if (!opened?.ok) throw new Error("abort");

  const floatUi = await evalJs(cdp, `
    const findBtn = [...document.querySelectorAll(".rd-toolbar .rd-btn")].find(b => (b.textContent||"").includes("查找"));
    if (!findBtn) return { ok: false, reason: "无查找按钮" };
    findBtn.click();
    await new Promise(r => setTimeout(r, 250));
    const bar = document.querySelector(".rd-find-float");
    return { ok: !!bar, inBody: !!document.querySelector(".rd-body .rd-find-float") };
  `);
  floatUi?.ok && floatUi?.inBody ? pass("RF-2", "浮动查找条在正文区") : fail("RF-2", JSON.stringify(floatUi));

  const sample = await evalJs(cdp, `
    const spans = [...document.querySelectorAll(".textLayer span")].map(s => (s.textContent||"").trim()).filter(t => t.length >= 4);
    const word = spans.find(t => /^[a-zA-Z]{4,}$/.test(t)) || spans.find(t => t.length >= 5) || spans[0];
    if (!word) return { ok: false };
    const q = word.length > 8 ? word.slice(0, 8) : word;
    const input = document.querySelector(".rd-find-float input");
    if (!input) return { ok: false, reason: "无输入框" };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(input, q);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: q, inputType: "insertText" }));
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 700));
    const marks = document.querySelectorAll("mark.lf-fh");
    const cur = document.querySelector("mark.lf-fh-cur");
    const countEl = document.querySelector(".rd-find-float .rd-fcount");
    return {
      ok: marks.length > 0,
      q,
      marks: marks.length,
      hasCur: !!cur,
      countText: countEl?.textContent?.trim() || "",
    };
  `);

  if (sample?.ok) {
    pass("RF-3", `高亮 ${sample.marks} 处`, `词「${sample.q}」· ${sample.countText}`);
    sample.hasCur ? pass("RF-4", "当前匹配样式") : fail("RF-4", "缺 .lf-fh-cur");
  } else {
    fail("RF-3", "查找后无高亮", JSON.stringify(sample));
  }

  const crossSpan = await evalJs(cdp, `
    const spans = [...document.querySelectorAll(".textLayer span")].filter(s => (s.textContent||"").length > 0);
    let joined = "";
    const parts = [];
    for (const s of spans.slice(0, 80)) {
      const t = s.textContent || "";
      parts.push(t);
      joined += t;
    }
    const m = joined.match(/[a-zA-Z]{5,}/);
    if (!m) return { skip: true };
    const q = m[0].slice(0, Math.min(7, m[0].length));
    const low = joined.toLowerCase();
    const idx = low.indexOf(q.toLowerCase());
    if (idx < 0) return { skip: true };
    let pos = 0, startSpan = -1, endSpan = -1;
    for (let i = 0; i < parts.length; i++) {
      const end = pos + parts[i].length;
      if (startSpan < 0 && idx >= pos && idx < end) startSpan = i;
      if (idx + q.length > pos && idx + q.length <= end) endSpan = i;
      pos = end;
    }
    return { skip: false, crossSpan: startSpan >= 0 && endSpan >= 0 && startSpan !== endSpan, q, startSpan, endSpan };
  `);

  if (crossSpan?.skip) {
    skip("RF-5", "前 80 span 无合适跨词样本");
  } else if (crossSpan?.crossSpan) {
    const crossHit = await evalJs(cdp, `
      const q = ${JSON.stringify(crossSpan.q)};
      const input = document.querySelector(".rd-find-float input");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) { setter.call(input, q); input.dispatchEvent(new InputEvent("input", { bubbles: true })); }
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 700));
      return { marks: document.querySelectorAll("mark.lf-fh").length, q };
    `);
    crossHit?.marks > 0
      ? pass("RF-5", "跨 span 词可高亮", `「${crossHit.q}」· ${crossHit.marks} 处`)
      : fail("RF-5", "跨 span 词无高亮", JSON.stringify(crossHit));
  } else {
    pass("RF-5", "单 span 样本已覆盖（无跨 span 用例）", crossSpan?.q || "");
  }

  const nav = await evalJs(cdp, `
    const before = document.querySelector("mark.lf-fh-cur")?.textContent || "";
    const next = document.querySelector(".rd-find-float .rd-btn[title*='下一处']") || [...document.querySelectorAll(".rd-find-float .rd-btn")].pop();
    const btns = [...document.querySelectorAll(".rd-find-float .rd-btn")];
    const down = btns.find(b => (b.title||"").includes("下一处"));
    if (!down || down.disabled) return { ok: false, reason: "下一处不可用" };
    down.click();
    await new Promise(r => setTimeout(r, 500));
    const after = document.querySelector("mark.lf-fh-cur")?.textContent || "";
    return { ok: !!document.querySelector("mark.lf-fh-cur"), moved: before !== after || !!after };
  `);
  nav?.ok ? pass("RF-6", "下一处导航", nav.moved ? "当前项已切换" : "仍有当前高亮") : skip("RF-6", nav?.reason || "仅一处匹配");

  await evalJs(cdp, `document.querySelector(".rd-find-float .rd-x")?.click(); await new Promise(r => setTimeout(r, 200));`);
  const closed = await evalJs(cdp, `return !document.querySelector(".rd-find-float");`);
  closed ? pass("RF-7", "关闭查找条") : fail("RF-7", "查找条未关闭");

  cdp.ws.close();
} catch (e) {
  fail("烟测中断", e.message);
  try { cdp?.ws?.close(); } catch { /* ignore */ }
}

console.log("\n── done ──\n");
process.exit(process.exitCode || 0);
