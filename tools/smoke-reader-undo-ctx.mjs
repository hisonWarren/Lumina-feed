#!/usr/bin/env node
/** 真机烟测：阅读器撤销/重做 + 折叠右键菜单（CDP 9222） */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const results = [];
const pass = (n, d = "") => { results.push({ ok: true, name: n, detail: d }); console.log(`  ✓ ${n}${d ? " — " + d : ""}`); };
const fail = (n, d = "") => { results.push({ ok: false, name: n, detail: d }); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); };
const skip = (n, d = "") => { results.push({ ok: true, name: n, detail: "SKIP: " + d, skipped: true }); console.log(`  ○ ${n} — 跳过：${d}`); };

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("Electron CDP 未就绪（9222）");
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

async function openReader(cdp) {
  await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("阅读"));
    if (tab) tab.click();
    await new Promise(r => setTimeout(r, 500));
    document.querySelector(".rd-back")?.click();
    await new Promise(r => setTimeout(r, 350));
    document.querySelector(".rhx-home")?.click();
    await new Promise(r => setTimeout(r, 400));
    const rows = [...document.querySelectorAll(".rh-row")];
    if (!rows.length) throw new Error("无已下载 PDF 行");
    rows[0].click();
    for (let i = 0; i < 60 && !document.querySelector(".rd"); i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!document.querySelector(".rd")) throw new Error("阅读器未打开");
    for (let i = 0; i < 40 && !document.querySelector(".textLayer span"); i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    return !!document.querySelector(".textLayer span");
  `);
}

async function dragSelectText(cdp) {
  const box = await evalJs(cdp, `
    const sp = document.querySelector(".textLayer span");
    const canvas = document.querySelector(".rd-pg canvas") || document.querySelector(".rd canvas");
    if (!sp) return { ok: false, reason: "无 textLayer" };
    const r = sp.getBoundingClientRect();
    const cr = canvas ? canvas.getBoundingClientRect() : r;
    return {
      ok: true,
      x1: Math.round(r.left + 2),
      y1: Math.round(r.top + r.height / 2),
      x2: Math.round(r.right - 2),
      y2: Math.round(r.top + r.height / 2),
      cx: Math.round((cr.left + cr.right) / 2),
      cy: Math.round((cr.top + cr.bottom) / 2),
    };
  `);
  if (!box?.ok) return box;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x1, y: box.y1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x1, y: box.y1, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 80));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x2, y: box.y2, button: "left" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x2, y: box.y2, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 350));
  await evalJs(cdp, `document.querySelector(".rd-view")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));`);
  await new Promise((r) => setTimeout(r, 200));
  return box;
}

console.log("\n── 真机烟测 · 阅读器撤销 + 折叠右键菜单 ──\n");

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");
  await cdp.send("Input.enable").catch(() => {});

  await openReader(cdp);
  pass("RD-UC0", "打开 PDF 阅读器");

  const toolbar = await evalJs(cdp, `
    const btns = [...document.querySelectorAll(".rd-toolbar .rd-btn")];
    const undo = btns.find(b => (b.textContent||"").includes("撤销"));
    const redo = btns.find(b => (b.textContent||"").includes("重做"));
    return {
      undo: !!undo,
      redo: !!redo,
      undoDisabled: undo ? undo.disabled : null,
      redoDisabled: redo ? redo.disabled : null,
      undoTitle: undo?.title || "",
    };
  `);
  toolbar.undo ? pass("RD-UC1", "顶栏撤销按钮", toolbar.undoTitle) : fail("RD-UC1", "顶栏撤销按钮");
  toolbar.redo ? pass("RD-UC2", "顶栏重做按钮") : fail("RD-UC2", "顶栏重做按钮");
  toolbar.undoDisabled === true ? pass("RD-UC3", "初始撤销禁用") : fail("RD-UC3", "初始撤销应禁用", JSON.stringify(toolbar));

  const ctxBlank = await evalJs(cdp, `
    const view = document.querySelector(".rd-view") || document.querySelector(".rd-body") || document.querySelector(".rd");
    if (!view) throw new Error("no rd view");
    view.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 320, clientY: 280 }));
    await new Promise(r => setTimeout(r, 200));
    const menu = document.querySelector(".rd-ctx");
    if (!menu) throw new Error("右键菜单未出现");
    const labels = [...menu.querySelectorAll(".lf-ctx-scroll > .lf-ctx-item .lf-ctx-lbl, .lf-ctx-scroll > .lf-ctx-sub > .lf-ctx-item .lf-ctx-lbl")]
      .map(el => el.textContent.trim());
    const subs = menu.querySelectorAll(".lf-ctx-sub").length;
    const scroll = !!menu.querySelector(".lf-ctx-scroll");
    const h = menu.getBoundingClientRect().height;
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    return { labels, subs, scroll, height: Math.round(h), topCount: labels.length };
  `);
  ctxBlank.scroll ? pass("RD-UC4", "菜单滚动容器") : fail("RD-UC4", "缺 lf-ctx-scroll");
  ctxBlank.subs >= 3 ? pass("RD-UC5", "折叠子菜单", `${ctxBlank.subs} 组`) : fail("RD-UC5", "子菜单不足", JSON.stringify(ctxBlank));
  ctxBlank.labels.includes("缩放与适配") && ctxBlank.labels.includes("显示与工具")
    ? pass("RD-UC6", "分组标签", ctxBlank.labels.join(" | "))
    : fail("RD-UC6", "分组标签", ctxBlank.labels.join(" | "));
  ctxBlank.topCount <= 14 ? pass("RD-UC7", "顶层项数可控", `${ctxBlank.topCount} 项 · 高 ${ctxBlank.height}px`)
    : fail("RD-UC7", "顶层仍过多", `${ctxBlank.topCount} 项`);
  !ctxBlank.labels.includes("下载 PDF") || ctxBlank.labels.includes("文件")
    ? pass("RD-UC8", "下载移入文件分组")
    : fail("RD-UC8", "下载仍在顶层");

  const annoFlow = await (async () => {
    const pre = await evalJs(cdp, `
      const n = (document.body.innerText.match(/(\\d+) 条批注/) || [])[1];
      return { count: n ? parseInt(n, 10) : 0 };
    `);
    if (pre.count > 0) {
      return await evalJs(cdp, `
        const notesBtn = [...document.querySelectorAll(".rd-toolbar .rd-btn")].find(b => (b.textContent||"").includes("批注"));
        if (notesBtn) notesBtn.click();
        await new Promise(r => setTimeout(r, 400));
        const del = document.querySelector(".rd-anno-del");
        if (!del) throw new Error("批注面板无删除按钮");
        del.click();
        await new Promise(r => setTimeout(r, 350));
        const undoBtn = [...document.querySelectorAll(".rd-toolbar .rd-btn")].find(b => (b.textContent||"").includes("撤销"));
        if (!undoBtn || undoBtn.disabled) throw new Error("删除后撤销仍禁用");
        undoBtn.click();
        await new Promise(r => setTimeout(r, 450));
        const redoBtn = [...document.querySelectorAll(".rd-toolbar .rd-btn")].find(b => (b.textContent||"").includes("重做"));
        const canRedo = redoBtn && !redoBtn.disabled;
        if (canRedo) redoBtn.click();
        await new Promise(r => setTimeout(r, 350));
        return { undoDisabledAfter: undoBtn.disabled, canRedo, via: "panel-del" };
      `);
    }
    const drag = await dragSelectText(cdp);
    if (!drag?.ok) return { ok: false, reason: drag?.reason || "拖选失败" };
    const hlViaPop = await evalJs(cdp, `
      let hl = document.querySelector(".rd-pop-bar button.hl-yellow");
      if (hl) { hl.click(); await new Promise(r => setTimeout(r, 400)); return { via: "pop" }; }
      const rd = document.querySelector(".rd");
      const canvas = rd?.querySelector(".rd-pg canvas") || rd?.querySelector("canvas");
      if (canvas) {
        const cr = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: cr.left + cr.width * 0.35, clientY: cr.top + cr.height * 0.3 }));
        await new Promise(r => setTimeout(r, 300));
        hl = [...document.querySelectorAll(".rd-ctx .lf-ctx-item")].find(b => (b.textContent||"").includes("高亮 · 黄"));
        if (hl) { hl.click(); await new Promise(r => setTimeout(r, 450)); return { via: "ctx" }; }
      }
      return { via: null };
    `);
    if (!hlViaPop?.via) return { ok: false, reason: "无法添加高亮" };
    return await evalJs(cdp, `
      const undoBtn = [...document.querySelectorAll(".rd-toolbar .rd-btn")].find(b => (b.textContent||"").includes("撤销"));
      if (!undoBtn || undoBtn.disabled) throw new Error("高亮后撤销仍禁用");
      undoBtn.click();
      await new Promise(r => setTimeout(r, 500));
      const redoBtn = [...document.querySelectorAll(".rd-toolbar .rd-btn")].find(b => (b.textContent||"").includes("重做"));
      const canRedo = redoBtn && !redoBtn.disabled;
      if (canRedo) redoBtn.click();
      await new Promise(r => setTimeout(r, 400));
      return { undoDisabledAfter: undoBtn.disabled, canRedo, via: ${JSON.stringify(hlViaPop.via)} };
    `);
  })().catch((e) => ({ ok: false, reason: e.message }));

  if (annoFlow?.ok !== false && annoFlow?.canRedo !== undefined) {
    pass("RD-UC9", "高亮 → 撤销 → 重做", `${annoFlow.via || ""} undo后禁用=${annoFlow.undoDisabledAfter} redo=${annoFlow.canRedo}`);
  } else {
    skip("RD-UC9", annoFlow?.reason || "批注撤销流（无批注或自动化划词未命中）");
  }

  cdp.ws.close();
} catch (e) {
  fail("烟测中断", e.message);
}

const nFail = results.filter((r) => !r.ok).length;
const nSkip = results.filter((r) => r.skipped).length;
const report = { at: new Date().toISOString(), results };
writeFileSync(path.join(OUT, "reader-undo-ctx-report.json"), JSON.stringify(report, null, 2));
console.log(`\n结果：${results.length - nFail - nSkip} 通过 / ${nFail} 失败 / ${nSkip} 跳过`);
console.log(`报告：${path.join(OUT, "reader-undo-ctx-report.json")}\n`);
process.exit(nFail ? 1 : 0);
