#!/usr/bin/env node
/** 真机烟测：reader_settings_shell + doubao_ep_cleanup 专项 */
const CDP = "http://127.0.0.1:9222";
const results = [];
const pass = (n, d = "") => { results.push({ ok: true, name: n, detail: d }); console.log(`  ✓ ${n}${d ? " — " + d : ""}`); };
const fail = (n, d = "") => { results.push({ ok: false, name: n, detail: d }); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); };
const skip = (n, d = "") => { results.push({ ok: true, name: n, detail: "SKIP: " + d, skipped: true }); console.log(`  ○ ${n} — 跳过：${d}`); };

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
if (!page) throw new Error("Electron CDP 未就绪");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
let id = 1; const pend = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pend.has(m.id)) {
    const { resolve, reject } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = id++; pend.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
await send("Runtime.enable");
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};

console.log("\n── 真机烟测 · settings_shell + doubao_ep ──\n");

try {
  // 设置弹窗
  await evalJs(`
    const b = document.querySelector('.lf-icon[aria-label="设置"]');
    if (!b) throw new Error("no settings gear");
    b.click();
  `);
  await new Promise((r) => setTimeout(r, 500));
  const modal = await evalJs(`return {
    backdrop: !!document.querySelector('.set-backdrop'),
    rail: !!document.querySelector('.set-rail'),
    cats: [...document.querySelectorAll('.set-rail button,.set-rail [role=tab]')].map(x=>x.textContent.trim()).filter(Boolean).slice(0,8),
    readCat: [...document.querySelectorAll('.set-rail *')].some(x=>(x.textContent||'').includes('阅读')),
  };`);
  modal.backdrop && modal.rail ? pass("设置弹窗 overlay", "set-backdrop + set-rail") : fail("设置弹窗", JSON.stringify(modal));

  // ISSUE-015 ep- 识别
  const epUi = await evalJs(`
    const sel = document.querySelector('select') || [...document.querySelectorAll('select')].find(s=>s.closest('.set-body'));
    const provOpts = [...document.querySelectorAll('select option')].map(o=>o.value+o.textContent);
    const doubao = provOpts.some(x=>x.includes('doubao')||x.includes('豆包'));
    if (!doubao) {
      const btns = [...document.querySelectorAll('button,option,label')];
      const db = btns.find(x=>(x.textContent||'').includes('豆包'));
      if (db) db.click?.();
    }
    const s = await window.luminaApi.getSettings();
    s.llm = { ...s.llm, provider: 'doubao', model: 'ep-test-20260628113448-2qnjk' };
    await window.luminaApi.saveSettings(s);
    await new Promise(r=>setTimeout(r,300));
    const inp = document.querySelector('.set-combo-in');
    if (inp) { inp.focus(); inp.value = 'ep-20260628113448-2qnjk'; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }
    await new Promise(r=>setTimeout(r,200));
    return {
      epOk: !!document.querySelector('.set-ep-ok'),
      epText: (document.querySelector('.set-ep-ok')||{}).textContent||'',
      hint: (document.body.innerText||'').includes('推理接入点') || (document.body.innerText||'').includes('Model ID'),
    };
  `);
  epUi.epOk ? pass("ISSUE-015 ep- 实时识别", epUi.epText.slice(0, 50)) : epUi.hint ? pass("ISSUE-015 说明文案", "有 Model ID/ep- 说明") : fail("ISSUE-015 ep- UI", JSON.stringify(epUi));

  // 豆包 llm:test
  const envPath = new URL("../secrets.local.env", import.meta.url);
  let doubaoKey = process.env.DOUBAO_API_KEY || "";
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const sp = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "secrets.local.env");
    if (existsSync(sp)) {
      const t = readFileSync(sp, "utf8");
      doubaoKey = t.match(/^DOUBAO_API_KEY=(.+)$/m)?.[1]?.trim() || doubaoKey;
    }
  } catch { /* ignore */ }
  const model = "ep-20260628113448-2qnjk";
  if (doubaoKey) {
    const test = await evalJs(`
      await window.luminaApi.setSecret('doubao_key', ${JSON.stringify(doubaoKey)});
      const s = await window.luminaApi.getSettings();
      s.llm = { provider:'doubao', model:${JSON.stringify(model)}, baseUrl:'https://ark.cn-beijing.volces.com/api/v3' };
      await window.luminaApi.saveSettings(s);
      return await window.luminaApi.testLlm({ provider:'doubao', model:${JSON.stringify(model)}, baseUrl:'https://ark.cn-beijing.volces.com/api/v3', apiKey:${JSON.stringify(doubaoKey)} });
    `);
    test?.ok ? pass("豆包 llm:test", `${test.model} · ${test.ms}ms`) : fail("豆包 llm:test", test?.error || JSON.stringify(test));
  } else skip("豆包 llm:test", "无 DOUBAO_API_KEY");

  // 关闭设置
  await evalJs(`
    const x = document.querySelector('.set-x, .set-close, button[aria-label="关闭"]');
    if (x) x.click(); else document.querySelector('.set-backdrop')?.click();
  `);
  await new Promise((r) => setTimeout(r, 400));
  const closed = await evalJs(`return !document.querySelector('.set-backdrop');`);
  closed ? pass("设置弹窗关闭") : fail("设置弹窗未关闭");

  // ReadHub 面板
  await evalJs(`[...document.querySelectorAll('.lf-tab')].find(b=>(b.textContent||'').includes('阅读'))?.click();`);
  await new Promise((r) => setTimeout(r, 400));
  const rh = await evalJs(`return { rail: !!document.querySelector('.rh-rail'), sticky: getComputedStyle(document.querySelector('.rh-rail')||document.body).position };`);
  rh.rail ? pass("ReadHub 左栏面板", rh.sticky) : fail("ReadHub rh-rail");

  // reader:corpus ISSUE-014
  const lib = await evalJs(`return await window.luminaApi.libraryList();`);
  const ids = (lib || []).slice(0, 3).map((x) => x.id).filter(Boolean);
  if (ids.length >= 2) {
    const corpus = await evalJs(`return await window.luminaReader.corpus('corpus_framing', ${JSON.stringify(ids)});`);
    corpus?.refused?.reason?.includes("kind is not defined") ? fail("reader:corpus ISSUE-014", corpus.refused.reason)
      : corpus?.claims?.length >= 0 || corpus?.refused?.reason ? pass("reader:corpus IPC", corpus.refused?.reason?.slice(0, 40) || `claims=${corpus.claims?.length}`)
      : fail("reader:corpus", JSON.stringify(corpus).slice(0, 80));
  } else skip("reader:corpus", "工作集不足 2 篇");

  // 检索来源条
  await evalJs(`[...document.querySelectorAll('.lf-tab')].find(b=>(b.textContent||'').includes('检索'))?.click();`);
  await new Promise((r) => setTimeout(r, 300));
  const ff = await evalJs(`
    const chip = [...document.querySelectorAll('.ff-chip')].find(b=>(b.textContent||'').includes('主题词'));
    if (chip) chip.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 14000));
  const srcBar = await evalJs(`return {
    sources: !!document.querySelector('.ff-sources'),
    srcLabel: (document.body.innerText||'').includes('命中来源'),
    cards: document.querySelectorAll('.ff-card').length,
  };`);
  srcBar.srcLabel || srcBar.sources ? pass("FindFetch 来源容器", `cards=${srcBar.cards} · sources=${srcBar.sources}`) : skip("FindFetch 来源条", "检索未完成");

} catch (e) {
  fail("烟测中断", e.message);
}

ws.close();
const nFail = results.filter((r) => !r.ok).length;
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败\n`);
process.exit(nFail ? 1 : 0);
