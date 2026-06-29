#!/usr/bin/env node
/** 连续阅读：主视区滚到第 N 页时，侧栏缩略图应滚入 .rd-sidebody 可视区 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = process.env.CDP || "http://127.0.0.1:9223";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

async function main() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("CDP 未就绪 — 请先启动 Electron --remote-debugging-port=9223");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Runtime.enable");
  await send("Page.enable");

  const evalJs = async (expr) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: `(async()=>{ ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
    return result.value;
  };

  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const fp = path.join(OUT, `${name}.png`);
    writeFileSync(fp, Buffer.from(data, "base64"));
    return fp;
  };

  const ARXIV = "smoke-arxiv-1706";
  const TARGET = 9;

  const opened = await evalJs(`
    const ARXIV = ${JSON.stringify(ARXIV)};
    const URL = "https://arxiv.org/pdf/1706.03762.pdf";
    const list = await window.luminaOa.listPdfs();
    if (!list.find(x => x.paperId === ARXIV)) await window.luminaOa.fetchPdf(URL, ARXIV);
    await window.luminaReader.recordOpen({ paperId: ARXIV, title: "Attention", page: 1 });
    const readTab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("\\u9605\\u8bfb"));
    if (readTab) readTab.click();
    await new Promise(r => setTimeout(r, 900));
    let opened = false;
    const existingTab = document.querySelector(".rhx-tab:not(.rhx-home)");
    if (existingTab) {
      existingTab.click();
      await new Promise(r => setTimeout(r, 600));
      if (document.querySelector(".rd") && !document.querySelector(".rd-loading")) opened = true;
    }
    if (!opened) {
      const row = [...document.querySelectorAll(".rh-row")].find(r =>
        (r.textContent||"").includes("Attention") || (r.textContent||"").includes("1706"));
      if (row) { row.click(); await new Promise(r => setTimeout(r, 800)); }
    }
    for (let i = 0; i < 60; i++) {
      if (document.querySelector(".rd") && !document.querySelector(".rd-loading")) { opened = true; break; }
      await new Promise(r => setTimeout(r, 400));
    }
    if (!opened) return { ok: false, reason: "reader not open", rh: !!document.querySelector(".rh") };
    const contBtn = [...document.querySelectorAll(".rd-views button")].find(b => (b.textContent||"").includes("\\u8fde\\u7eed"));
    if (contBtn && !contBtn.classList.contains("on")) contBtn.click();
    if (!document.querySelector(".rd-sidebody .rd-thumbs")) {
      const thumbsBtn = document.querySelector('.rd-railbtn[title*="\\u9875\\u9762"]');
      if (thumbsBtn) thumbsBtn.click();
    }
    await new Promise(r => setTimeout(r, 400));
    return { ok: true, numPages: document.body.innerText.match(/\\/\\s*(\\d+)/)?.[1] };
  `);

  if (!opened?.ok) {
    console.error("FAIL open:", opened);
    process.exit(1);
  }
  console.log("✓ PDF 阅读器已打开");

  const before = await evalJs(`
    const side = document.querySelector(".rd-sidebody");
    const view = document.querySelector(".rd-view");
    return {
      page: document.querySelector(".rd-pageind input")?.value,
      sideScroll: side?.scrollTop ?? -1,
      sideH: side?.clientHeight ?? 0,
    };
  `);
  console.log("  初始:", before);

  const scrollToPage = await evalJs(`
    const TARGET = ${TARGET};
    const el = document.getElementById("rd-pg-" + TARGET);
    const view = document.querySelector(".rd-view");
    if (!el || !view) return { ok: false, reason: "no pg el" };
    el.scrollIntoView({ block: "start", behavior: "instant" });
    await new Promise(r => setTimeout(r, 100));
    view.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 200));

    const side = document.querySelector(".rd-sidebody");
    const thumb = document.getElementById("rd-thumb-" + TARGET);
    const active = document.querySelector(".rd-thumb.active");
    const pageInput = document.querySelector(".rd-pageind input")?.value;

    const intersectsSide = (() => {
      if (!side || !thumb) return false;
      const s = side.getBoundingClientRect();
      const t = thumb.getBoundingClientRect();
      return t.bottom > s.top + 4 && t.top < s.bottom - 4;
    })();

    return {
      ok: true,
      pageInput,
      target: TARGET,
      sideScroll: side?.scrollTop ?? 0,
      sideScrollH: side?.scrollHeight ?? 0,
      activeId: active?.id || "",
      thumbFound: !!thumb,
      intersectsSide,
      activePageNum: active?.querySelector("span")?.textContent,
    };
  `);

  await shot("side-thumb-scroll-p" + TARGET);
  console.log("  滚到第", TARGET, "页后:", scrollToPage);

  const pass = scrollToPage.pageInput === String(TARGET)
    && scrollToPage.activeId === "rd-thumb-" + TARGET
    && scrollToPage.intersectsSide;

  console.log(errors.length ? "  运行时错误: " + errors.join("; ") : "");
  console.log(pass ? `\n✓ PASS 侧栏缩略图已同步到第 ${TARGET} 页（scrollTop=${scrollToPage.sideScroll}）`
    : `\n✗ FAIL 侧栏未滚到当前页 — active=${scrollToPage.activeId} intersects=${scrollToPage.intersectsSide} page=${scrollToPage.pageInput}`);
  console.log("  截图:", path.join(OUT, `side-thumb-scroll-p${TARGET}.png`));

  ws.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
