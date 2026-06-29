#!/usr/bin/env node
/** 真机 API 通路 · 单 CDP 连接 */
const CDP = "http://127.0.0.1:9222";

const CASES = [
  { label: "bare-doi", q: "10.1038/nature12373", expectMode: "identifier" },
  { label: "doi-prefix", q: "doi:10.1038/nature12373", expectMode: "identifier" },
  { label: "DOI-upper", q: "DOI:10.1038/nature12373", expectMode: "identifier" },
  { label: "https-doi", q: "https://doi.org/10.1038/nature12373", expectMode: "identifier" },
  { label: "http-dx", q: "http://dx.doi.org/10.1038/nature12373", expectMode: "identifier" },
  { label: "arxiv-doi", q: "10.48550/arXiv.1706.03762", expectMode: "identifier" },
  { label: "covid", q: "covid vaccine efficacy", forbidExact: true },
];

async function connect() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP 未就绪");
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
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  const evalJs = async (expr, timeoutMs = 90000) => {
    const p = send("Runtime.evaluate", {
      expression: `(async()=>{ ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const t = new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs));
    const { result, exceptionDetails } = await Promise.race([p, t]);
    if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
    return result.value;
  };
  return { ws, evalJs };
}

let ng = 0;
const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); ng++; };

console.log("\n真机 API 通路探针\n");
const { ws, evalJs } = await connect();

for (const c of CASES) {
  console.log(`\n── ${c.label} ──`);
  const t0 = Date.now();
  try {
    const r = await evalJs(`return await window.luminaApi.searchOnline(${JSON.stringify(c.q)}, {});`, c.forbidExact ? 180000 : 60000);
    const ms = Date.now() - t0;
    const p0 = r?.papers?.[0];
    console.log(`  · ${ms}ms mode=${r?.locateMode} count=${r?.count ?? r?.papers?.length} kind=${p0?._matchKind} title=${(p0?.title || "").slice(0, 50)}`);

    if (c.expectMode === "identifier") {
      if (r?.locateMode === "identifier" && (r?.papers?.length ?? 0) === 1) pass("identifier 单卡", (p0?.title || "").slice(0, 45));
      else fail("identifier", `mode=${r?.locateMode} n=${r?.papers?.length}`);
    }
    if (c.forbidExact) {
      const pf = (r?.papers || []).find((p) => /Pfizer COVID/i.test(p.title || ""));
      if (pf?._matchKind === "title_strong") pass("Pfizer matchKind", "title_strong");
      else if (pf?._matchKind === "title_exact") fail("Pfizer matchKind", "title_exact");
      else fail("Pfizer matchKind", pf?._matchKind || "not found");
    }
  } catch (e) {
    fail(c.label, String(e.message || e));
  }
}

console.log("\n── covid UI badge ──");
try {
  await evalJs(`[...document.querySelectorAll('[role="tab"]')].find(t=>(t.textContent||'').includes('检索取文'))?.click();`);
  await evalJs(`
    const inp = document.querySelector('.ff-bar input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(inp, 'covid vaccine efficacy');
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return true;
  `);
  let badge = null;
  for (let i = 0; i < 90; i++) {
    badge = await evalJs(`return document.querySelector('.ff-card .lf-match')?.innerText?.trim()||null;`, 5000);
    if (badge) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (/完全一致/.test(badge || "")) fail("UI badge", badge);
  else if (/高度相似|高度匹配/.test(badge || "")) pass("UI badge", badge.slice(0, 55));
  else fail("UI badge", badge || "timeout");
} catch (e) {
  fail("UI badge", String(e.message || e));
}

ws.close();
console.log(`\npathways-api-real: ${ng === 0 ? "ALL PASS" : ng + " failed"}\n`);
process.exit(ng ? 1 : 0);
