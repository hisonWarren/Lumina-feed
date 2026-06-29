#!/usr/bin/env node
/** 补测：暗色主题 / 多标签开读 / 检索 UI 细节 */
const CDP = "http://127.0.0.1:9222";
const pass = (m, d = "") => console.log(`  ✓ ${m}${d ? " — " + d : ""}`);
const fail = (m, d = "") => { console.log(`  ✗ ${m}${d ? " — " + d : ""}`); process.exitCode = 1; };

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
if (!page) throw new Error("CDP 未就绪");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
let id = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject: rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = id++;
  pending.set(n, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send("Runtime.enable");
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};

console.log("\n── 补测：暗色主题 · 多标签 · 检索 UI ──\n");

// 暗色三主题
for (const tid of ["observatory", "dusk", "forest"]) {
  const surf = await evalJs(`
    const lf = document.querySelector(".lf");
    lf.setAttribute("data-theme", ${JSON.stringify(tid)});
    lf.classList.remove("day");
    return getComputedStyle(lf).getPropertyValue("--surf").trim();
  `);
  const dark = surf && surf !== "#F4F4F1" && surf !== "#fff" && surf !== "#FFFFFF";
  dark ? pass(`暗色主题 ${tid} --surf`, surf) : fail(`暗色主题 ${tid}`, surf || "empty");
}

// 恢复
await evalJs(`document.querySelector(".lf").setAttribute("data-theme","daylight"); document.querySelector(".lf").classList.add("day");`);

// 多标签：IPC 开已下载 PDF
await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("阅读")).click();`);
await new Promise((r) => setTimeout(r, 500));
const tabsBefore = await evalJs(`return document.querySelectorAll(".rhx-tab").length;`);
const opened = await evalJs(`
  const list = await window.luminaOa.listPdfs();
  const it = list[0];
  if (!it) return { ok: false, err: "no pdf" };
  const bytes = await window.luminaOa.readPdf(it.paperId);
  window.__smokeOpenPdf = { name: it.paperId + ".pdf", data: bytes, paperId: it.paperId };
  return { ok: true, id: it.paperId, bytes: bytes?.byteLength||0 };
`);
if (opened?.ok) {
  pass("readPdf 读回", `${opened.id} · ${opened.bytes} bytes`);
  // 触发 ReadHub open 逻辑 via React 不可直接调，模拟 incoming
  await evalJs(`
    window.dispatchEvent(new CustomEvent("lumina-smoke-open", { detail: window.__smokeOpenPdf }));
  `).catch(() => {});
  // 直接通过 bridge 路径：找 ReadHub 按钮
  const clicked = await evalJs(`
    const rows = [...document.querySelectorAll(".rh-dl-item, .rh-dl button, button")];
    const b = rows.find(x => (x.textContent||"").includes("打开") || (x.textContent||"").includes("smoke-arxiv"));
    if (b) { b.click(); return b.textContent.trim().slice(0,40); }
    return null;
  `);
  await new Promise((r) => setTimeout(r, 2500));
  const tabsAfter = await evalJs(`return document.querySelectorAll(".rhx-tab").length;`);
  tabsAfter > tabsBefore ? pass("multidoc 开读后标签", `${tabsBefore}→${tabsAfter}`) : fail("multidoc 标签未增加", clicked || "no open btn");
} else fail("readPdf", opened?.err);

// 检索：有结果后引用+排序
await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("检索")).click();`);
await new Promise((r) => setTimeout(r, 400));
await evalJs(`
  const inp = document.querySelector(".ff-in input, .ff-in, input[type=search], input");
  if (inp) { inp.focus(); inp.value = "covid vaccine"; inp.dispatchEvent(new Event("input", {bubbles:true})); }
  const go = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("检索"));
  if (go) go.click();
`);
await new Promise((r) => setTimeout(r, 12000));
const ui = await evalJs(`
  return {
    cards: document.querySelectorAll(".ff-card").length,
    cite: document.querySelectorAll(".ff-act").length,
    sort: !!document.querySelector(".ff-sort-btn"),
  };
`);
ui.cards > 0 ? pass("检索 UI ff-card", `${ui.cards} 张`) : fail("ff-card", "0");
ui.cite > 0 ? pass("finish 引用按钮（有结果后）", `${ui.cite} 个`) : fail("引用按钮");
ui.sort ? pass("nav_find 排序 select") : fail("排序 select");

ws.close();
console.log("\n补测完成\n");
