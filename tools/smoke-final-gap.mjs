#!/usr/bin/env node
/** 检索 UI + 多标签：直接 CDP 诊断 */
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index/.test(t.url || ""));
if (!page) { console.log("CDP 不可用"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
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
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};
await send("Runtime.enable");

console.log("\n── 最终补测 ──\n");

// FindFetch
await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("检索")).click();`);
await new Promise((r) => setTimeout(r, 400));
const search = await evalJs(`
  const chip = [...document.querySelectorAll(".ff-chip")].find(b=>(b.textContent||"").includes("aortic")||(b.textContent||"").includes("主题词"));
  if (chip) chip.click();
  else {
    const inp = document.querySelector(".ff-bar input");
    inp.value = "covid vaccine"; inp.dispatchEvent(new Event("input",{bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
  }
  return true;
`);
await new Promise((r) => setTimeout(r, 15000));
const ff = await evalJs(`
  return {
    cards: document.querySelectorAll(".ff-card").length,
    sort: !!document.querySelector(".ff-sort select"),
    cite: document.querySelectorAll("button.ff-act").length,
    err: document.querySelector(".ff-empty h2")?.textContent,
    loading: !!document.querySelector(".ff-spin"),
  };
`);
console.log("FindFetch:", ff);
ff.cards > 0 ? console.log("  ✓ ff-card", ff.cards) : console.log("  ✗ ff-card", JSON.stringify(ff));

// Multidoc via incoming simulation (read bytes + dispatch to window if hook exists)
await evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("阅读")).click();`);
await new Promise((r) => setTimeout(r, 600));
await evalJs(`document.querySelector(".rhx-home")?.click();`);
await new Promise((r) => setTimeout(r, 1200));
const md = await evalJs(`
  const pdfs = await window.luminaOa.listPdfs();
  if (!pdfs[0]) return { err: "no pdf" };
  const bytes = await window.luminaOa.readPdf(pdfs[0].paperId);
  const row = document.querySelector(".rh-row");
  if (row) row.click();
  return { paperId: pdfs[0].paperId, bytes: bytes?.byteLength, row: !!row };
`);
console.log("multidoc click:", md);
await new Promise((r) => setTimeout(r, 12000));
const tabs = await evalJs(`return { tabs: document.querySelectorAll(".rhx-tab").length, rd: !!document.querySelector(".rd") };`);
console.log("multidoc after wait:", tabs);
tabs.tabs > 0 ? console.log("  ✓ 多标签", tabs.tabs) : console.log("  ✗ 多标签未出现（待人工：点「已下载全文」行）");

// Dark themes (correct ids)
for (const tid of ["observatory", "dusk", "forest"]) {
  const surf = await evalJs(`
    const lf=document.querySelector(".lf");
    lf.setAttribute("data-theme",${JSON.stringify(tid)}); lf.classList.remove("day");
    return getComputedStyle(lf).getPropertyValue("--surf").trim();
  `);
  console.log(`  ${/^#0/i.test(surf) || surf.startsWith("#1") ? "✓" : "✗"} 暗色 ${tid}: ${surf}`);
}
await evalJs(`document.querySelector(".lf").setAttribute("data-theme","daylight"); document.querySelector(".lf").classList.add("day");`);

ws.close();
console.log("");
