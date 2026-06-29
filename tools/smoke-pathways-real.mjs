#!/usr/bin/env node
/** 真机通路 · DOI 格式 + covid 匹配标签 */
const CDP = "http://127.0.0.1:9222";

const CASES = [
  { label: "bare-doi", q: "10.1038/nature12373", expectMode: "identifier", forbidExact: false },
  { label: "doi-prefix", q: "doi:10.1038/nature12373", expectMode: "identifier", forbidExact: false },
  { label: "DOI-upper", q: "DOI:10.1038/nature12373", expectMode: "identifier", forbidExact: false },
  { label: "https-doi", q: "https://doi.org/10.1038/nature12373", expectMode: "identifier", forbidExact: false },
  { label: "http-dx", q: "http://dx.doi.org/10.1038/nature12373", expectMode: "identifier", forbidExact: false },
  { label: "arxiv-doi-url", q: "https://doi.org/10.48550/arXiv.1706.03762", expectMode: "identifier", forbidExact: false },
  { label: "covid-keyword", q: "covid vaccine efficacy", expectMode: "primary", forbidExact: true },
];

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP 9222 未就绪");
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

let ng = 0;
const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); ng++; };

console.log("\n真机通路探针\n");
const cdp = await cdpConnect(await getWsUrl());
await cdp.send("Runtime.enable");

await evalJs(cdp, `
  [...document.querySelectorAll('[role="tab"]')].find(t=>(t.textContent||'').includes('检索取文'))?.click();
`);
await new Promise((r) => setTimeout(r, 400));

for (const c of CASES) {
  console.log(`\n── ${c.label} · ${c.q.slice(0, 55)} ──`);
  await evalJs(cdp, `
    const btn = document.querySelector('.ff-session-new');
    if (btn) btn.click();
  `);
  await new Promise((r) => setTimeout(r, 300));

  const r = await evalJs(cdp, `
    const inp = document.querySelector('.ff-bar input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(inp, ${JSON.stringify(c.q)});
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(res => setTimeout(res, 500));
    for (let i = 0; i < 60; i++) {
      const n = document.querySelectorAll('.ff-card').length;
      const loading = document.querySelector('.ff-more')?.textContent?.includes('正在检索');
      if (n >= 1 && !loading) break;
      await new Promise(res => setTimeout(res, 1000));
    }
    const cards = [...document.querySelectorAll('.ff-card')].slice(0, 3).map(el => ({
      title: el.querySelector('.ff-title')?.innerText?.slice(0, 70),
      badge: el.querySelector('.lf-match')?.innerText?.trim(),
      matchKind: null,
    }));
    const api = await window.luminaApi.searchOnline(${JSON.stringify(c.q)}, {});
    return {
      locateMode: api?.locateMode,
      count: api?.papers?.length ?? 0,
      title: api?.papers?.[0]?.title?.slice(0, 70),
      matchKind: api?.papers?.[0]?._matchKind,
      cards,
      cardCount: document.querySelectorAll('.ff-card').length,
    };
  `);

  if (c.expectMode === "identifier") {
    if (r?.locateMode === "identifier" && r.count >= 1) pass("identifier 通道", `${r.count} 篇 · ${(r.title || "").slice(0, 50)}`);
    else fail("identifier 通道", JSON.stringify({ mode: r?.locateMode, count: r?.count }));
    if (r?.count > 50) fail("非关键词洪流", `count=${r.count}`);
  } else {
    if (r?.locateMode === "primary" || r?.locateMode === "keyword") pass("关键词/primary", r.locateMode);
    else fail("关键词模式", r?.locateMode);
  }

  const topKind = r?.matchKind || (r?.cards?.[0] && null);
  const badge = r?.cards?.[0]?.badge || "";
  if (c.forbidExact) {
    if (r?.matchKind === "title_strong" || r?.matchKind === "normal") pass("bm25 非 exact", r.matchKind);
    else if (r?.matchKind === "title_exact") fail("bm25 误标 exact", r.matchKind);
    else pass("bm25 kind", r?.matchKind || "n/a");
    if (/完全一致/.test(badge)) fail("UI badge 含「完全一致」", badge);
    else if (/高度相似|高度匹配/.test(badge)) pass("UI badge 正确", badge.slice(0, 40));
    else if (badge) fail("UI badge 异常", badge);
    else pass("UI badge", "无 exact 芯片或尚未渲染");
  }
}

cdp.ws.close();
console.log(`\npathways-real: ${CASES.length * 2 - ng}/${CASES.length * 2} checks (approx)\n`);
process.exit(ng ? 1 : 0);
