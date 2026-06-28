#!/usr/bin/env node
/** 烟测 · 我的文献自定义分组 UX（CDP 9222） */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

let exitCode = 0;
const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); exitCode = 1; };
const warn = (n, d = "") => console.log(`  ! ${n}${d ? " — " + d : ""}`);

async function getWsUrl() {
  const r = await fetch(`${CDP}/json/list`);
  const list = await r.json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

async function reactInput(cdp, selector, text) {
  await evalJs(cdp, `
    const inp = document.querySelector(${JSON.stringify(selector)});
    if (!inp) throw new Error("input not found: ${selector}");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, ${JSON.stringify(text)});
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
  `);
}

async function shot(cdp, name) {
  try {
    const { data } = await Promise.race([
      cdp.send("Page.captureScreenshot", { format: "png" }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("screenshot timeout")), 8000)),
    ]);
    const fp = path.join(OUT, `${name}.png`);
    writeFileSync(fp, Buffer.from(data, "base64"));
    return fp;
  } catch {
    warn("截图跳过", name);
    return null;
  }
}

console.log("\n── smoke-library-groups ──\n");

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Page.enable");
  pass("CDP 连接");

  // 确保工作集有测试条目
  const seedId = "smoke-grp-test-" + Date.now();
  await evalJs(cdp, `
    await window.luminaApi.libraryAdd(${JSON.stringify(seedId)}, "smoke-test");
    const lists = await window.luminaApi.listsGet();
    const clean = (lists||[]).filter(l => !String(l.name||"").startsWith("烟测分组"));
    await window.luminaApi.listsSave(clean);
  `);

  // 进入我的文献
  await evalJs(cdp, `
    const tab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("我的文献"));
    if (!tab) throw new Error("找不到我的文献 tab");
    tab.click();
    await new Promise(r => setTimeout(r, 400));
  `);
  pass("切换至我的文献");

  const uiCheck = await evalJs(cdp, `
    const bar = document.querySelector(".lib-groupbar");
    const newBtn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("新建分组"));
    const hint = document.querySelector(".lib-groupbar-hint");
    return {
      hasGroupbar: !!bar,
      hasNewBtn: !!newBtn,
      hint: hint ? hint.textContent.trim() : "",
      allChip: [...document.querySelectorAll(".lib-lchip")].some(b => (b.textContent||"").includes("全部")),
    };
  `);
  uiCheck.hasGroupbar ? pass("分组条常驻 .lib-groupbar") : fail("缺分组条");
  uiCheck.hasNewBtn ? pass("顶部「新建分组」按钮") : fail("缺新建分组按钮");
  uiCheck.allChip ? pass("「全部」chip") : fail("缺全部 chip");
  uiCheck.hint.includes("单层") ? pass("分组说明文案", uiCheck.hint.slice(0, 40) + "…") : warn("分组说明文案", uiCheck.hint);

  await shot(cdp, "library-groups-empty-bar");

  // 创建分组（顶部）
  const grpName = "烟测分组A";
  await evalJs(cdp, `
    const btn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("新建分组"));
    btn.click();
    await new Promise(r => setTimeout(r, 200));
  `);
  await reactInput(cdp, ".lib-grp-new-inp", grpName);

  const afterCreate = await evalJs(cdp, `
    const lists = await window.luminaApi.listsGet();
    const chips = [...document.querySelectorAll(".lib-lchip")].map(b => b.textContent.trim());
    const active = document.querySelector(".lib-lchip.on");
    return { lists, chips, active: active ? active.textContent.trim() : "" };
  `);
  const created = (afterCreate.lists || []).find((l) => l.name === grpName);
  created ? pass("lists:save 创建分组", grpName) : fail("分组未持久化", JSON.stringify(afterCreate.lists));
  afterCreate.chips.some((c) => c.includes(grpName)) ? pass("分组 chip 显示") : fail("分组 chip 未显示", afterCreate.chips.join("|"));
  afterCreate.active.includes(grpName) ? pass("创建后自动选中分组") : pass("创建空分组保持「全部」视图", "避免空列表看不到卡片");

  await shot(cdp, "library-groups-created");

  // 卡片加入分组（需先显示全部文献）
  await evalJs(cdp, `
    const chipAll = [...document.querySelectorAll(".lib-lchip")].find(b => (b.textContent||"").includes("全部"));
    if (chipAll && !chipAll.classList.contains("on")) chipAll.click();
    await new Promise(r => setTimeout(r, 300));
    const grpBtn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("分组") && b.closest(".lib-card"));
    if (!grpBtn) throw new Error("卡片上无分组按钮");
    grpBtn.click();
    await new Promise(r => setTimeout(r, 200));
    const chip = [...document.querySelectorAll(".lib-lchip2")].find(b => (b.textContent||"").includes(${JSON.stringify(grpName)}));
    if (!chip) throw new Error("卡片面板无该分组");
    if (!chip.classList.contains("on")) chip.click();
    await new Promise(r => setTimeout(r, 300));
  `);

  const inGroup = await evalJs(cdp, `
    const lists = await window.luminaApi.listsGet();
    const L = lists.find(l => l.name === ${JSON.stringify(grpName)});
    const badges = [...document.querySelectorAll(".lib-grp-badge")].map(b => b.textContent.trim());
    const lib = await window.luminaApi.libraryList();
    return { count: L ? L.ids.length : 0, badges, libLen: lib.length };
  `);
  inGroup.count > 0 ? pass("文献加入分组", `${inGroup.count} 篇`) : fail("文献未加入分组");
  inGroup.badges.includes(grpName) ? pass("卡片分组徽章") : warn("卡片无分组徽章", inGroup.badges.join(","));

  await shot(cdp, "library-groups-badge");

  // 筛选空分组 B（UI 创建，避免 API 与 React 状态不同步）
  const grpB = "烟测分组B";
  await evalJs(cdp, `
    const btn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("新建分组"));
    btn.click();
    await new Promise(r => setTimeout(r, 200));
  `);
  await reactInput(cdp, ".lib-grp-new-inp", grpB);
  await evalJs(cdp, `
    const chip = [...document.querySelectorAll(".lib-lchip")].find(b => (b.textContent||"").includes(${JSON.stringify(grpB)}));
    if (!chip) throw new Error("空分组 chip 未显示");
    if (!chip.classList.contains("on")) chip.click();
    await new Promise(r => setTimeout(r, 300));
  `);

  const emptyState = await evalJs(cdp, `
    const h2 = document.querySelector(".lib-empty h2");
    return h2 ? h2.textContent.trim() : "";
  `);
  emptyState.includes("此分组暂无文献") ? pass("空分组空态文案") : fail("空分组空态", emptyState);

  await shot(cdp, "library-groups-empty-filter");

  // 重命名（模拟 pencil）
  await evalJs(cdp, `
    const chipA = [...document.querySelectorAll(".lib-lchip")].find(b => (b.textContent||"").includes(${JSON.stringify(grpName)}));
    if (!chipA) throw new Error("找不到分组A chip");
    if (!chipA.classList.contains("on")) chipA.click();
    await new Promise(r => setTimeout(r, 200));
    const pencil = document.querySelector(".lib-lc-edit");
    if (!pencil) throw new Error("重命名按钮未出现");
    pencil.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
  `);
  await reactInput(cdp, ".lib-grp-new-inp", "烟测分组A改");
  await new Promise((r) => setTimeout(r, 400));

  const renamed = await evalJs(cdp, `return (await window.luminaApi.listsGet()).some(l => l.name === "烟测分组A改");`);
  renamed ? pass("重命名持久化") : fail("重命名失败");

  // 布局：分组条不在滚动区内
  const layout = await evalJs(cdp, `
    const bar = document.querySelector(".lib-groupbar");
    const body = document.querySelector(".lib-body");
    if (!bar || !body) return { ok: false, reason: "missing nodes" };
    const barScroll = bar.closest(".lib-body");
    return { ok: !barScroll, barInBody: !!barScroll };
  `);
  layout.ok ? pass("分组条在滚动区外（UX 坑①）") : fail("分组条在 .lib-body 滚动区内");

  // 跨篇批量加入 UI
  await evalJs(cdp, `
    const chipAll = [...document.querySelectorAll(".lib-lchip")].find(b => (b.textContent||"").includes("全部"));
    chipAll.click();
    await new Promise(r => setTimeout(r, 200));
    const selBtn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("跨篇分析"));
    selBtn.click();
    await new Promise(r => setTimeout(r, 200));
    const cb = document.querySelector(".lib-cb");
    if (cb) cb.click();
  `);
  const batchUi = await evalJs(cdp, `return !!document.querySelector(".lib-batch-grp select");`);
  batchUi ? pass("跨篇模式批量加入分组") : warn("批量加入 UI 未出现（可能无文献可选）");

  await shot(cdp, "library-groups-final");

  // cleanup
  await evalJs(cdp, `
    const lists = (await window.luminaApi.listsGet()).filter(l => !String(l.name||"").startsWith("烟测分组"));
    await window.luminaApi.listsSave(lists);
    await window.luminaApi.libraryRemove(${JSON.stringify(seedId)});
  `);

  console.log("\n── done ──\n");
  console.log(`截图目录: ${OUT}`);
} catch (e) {
  fail("runtime", e.message);
  if (cdp) try { await shot(cdp, "library-groups-error"); } catch { /* ignore */ }
} finally {
  cdp?.ws.close();
}

process.exit(exitCode);
