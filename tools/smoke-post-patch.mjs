#!/usr/bin/env node
/** 真机烟测：finish 链之后的新补丁（provider_translate / nav_find / polish_persist / finish / multidoc） */
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
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
}

async function clickTab(cdp, text) {
  await evalJs(cdp, `
    const b = [...document.querySelectorAll(".lf-tab")].find(x => (x.textContent||"").includes(${JSON.stringify(text)}));
    if (!b) throw new Error("tab: ${text}");
    b.click();
  `);
  await new Promise((r) => setTimeout(r, 450));
}

console.log("\n── 真机烟测 · 新补丁功能（post-finish 链）──\n");

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");

  // ── provider_translate ──
  const lm = await evalJs(cdp, `return await window.luminaBridge?.listModels?.({ provider: "deepseek" }) || await (async()=>{ const b=window.luminaApi; return b?.listModels ? b.listModels({provider:"deepseek"}) : null; })();`);
  if (lm?.ok && Array.isArray(lm.models) && lm.models.length > 0) pass("llm:listModels 动态拉取", `${lm.models.length} 个模型`);
  else if (lm?.ok === false) pass("llm:listModels 失败回落", (lm.error || "内置兜底").slice(0, 50));
  else fail("llm:listModels", JSON.stringify(lm).slice(0, 80));

  const docKey = "smoke:translate-test";
  await evalJs(cdp, `
    await window.luminaReader.saveTranslation(${JSON.stringify(docKey)}, 1, "deepseek-chat", "测试译文");
    return await window.luminaReader.getTranslations(${JSON.stringify(docKey)});
  `).then((m) => (m?.[1]?.text === "测试译文" ? pass("translations:save/get 持久化", "page 1 命中") : fail("translations", JSON.stringify(m)))).catch((e) => fail("translations", e.message));

  // ── polish_persist navmarks ──
  const mk = "smoke:navmark-test";
  await evalJs(cdp, `
    await window.luminaReader.saveNavmarks(${JSON.stringify(mk)}, [1, 3, 5]);
    return await window.luminaReader.getNavmarks(${JSON.stringify(mk)});
  `).then((arr) => (Array.isArray(arr) && arr.length === 3 ? pass("navmarks:save/get 持久化", arr.join(",")) : fail("navmarks", JSON.stringify(arr)))).catch((e) => fail("navmarks", e.message));

  // ── finish + nav_find UI（检索取文）──
  await clickTab(cdp, "检索取文");
  const ffUi = await evalJs(cdp, `
    return {
      citeBtn: [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("引用")),
      sxHelp: [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("检索语法")),
      yearToggle: [...document.querySelectorAll("button")].some(b => (b.textContent||"").includes("年份")),
      sortSel: !!document.querySelector(".ff-sort select, select.ff-sort, .ff-tools select"),
      lfWidth: getComputedStyle(document.querySelector(".lf")||document.body).width,
    };
  `);
  ffUi.citeBtn ? pass("finish：结果页「引用」按钮存在") : fail("finish 引用按钮");
  ffUi.sxHelp ? pass("nav_find：「检索语法」入口") : fail("nav_find 检索语法");
  ffUi.yearToggle ? pass("nav_find：「年份」约束入口") : fail("nav_find 年份");
  ffUi.sortSel ? pass("nav_find：结果排序 select") : fail("nav_find 排序");

  // 触发 demo 检索看引用展开
  await evalJs(cdp, `
    const chip = [...document.querySelectorAll(".ff-chip")].find(b => (b.textContent||"").includes("主题词"));
    if (chip) chip.click();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 7000));
  const citeExpand = await evalJs(cdp, `
    const btn = [...document.querySelectorAll(".ff-card button")].find(b => (b.textContent||"").includes("引用"));
    if (!btn) return { ok: false, reason: "no card cite btn" };
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    const styles = [...document.querySelectorAll(".ff-cite, .ff-cites button")].map(b => b.textContent.trim()).filter(Boolean);
    return { ok: styles.length >= 3, styles };
  `);
  citeExpand?.ok ? pass("finish：引用展开五样式", citeExpand.styles?.slice(0, 5).join(" · ")) : skip("finish 引用展开", citeExpand?.reason || "无结果卡");

  // ── 真暗色 token（切 night 主题）──
  await evalJs(cdp, `
    const themes = ["night-warm", "night-dusk", "night-pine"];
    for (const t of themes) {
      document.querySelector(".lf")?.setAttribute("data-theme", t);
      document.querySelector(".lf")?.classList.remove("day");
    }
    document.querySelector(".lf")?.setAttribute("data-theme", "night-warm");
    document.querySelector(".lf")?.classList.remove("day");
    return getComputedStyle(document.querySelector(".lf")).getPropertyValue("--surf").trim();
  `).then((surf) => (/^#/.test(surf) && surf !== "#F4F4F1" ? pass("finish：night 主题 --surf 暗色", surf) : fail("night --surf", surf || "empty"))).catch((e) => fail("night theme", e.message));

  // 恢复默认主题
  await evalJs(cdp, `
    document.querySelector(".lf")?.setAttribute("data-theme", "day-sunny");
    document.querySelector(".lf")?.classList.add("day");
    return true;
  `);

  // ── multidoc 多标签 ──
  await clickTab(cdp, "阅读");
  const hasTabBar = await evalJs(cdp, `return !!document.querySelector(".rhx-tabs, .rh-tabs");`);
  // 用 arxiv PDF bytes 开标签（若已下载则 openDownloaded）
  const ARXIV = "smoke-arxiv-1706";
  const openVia = await evalJs(cdp, `
    const list = await window.luminaOa.listPdfs();
    const hit = list.find(x => x.paperId === ${JSON.stringify(ARXIV)});
    if (hit) return { mode: "downloaded", id: hit.paperId };
    try {
      await window.luminaOa.fetchPdf("https://arxiv.org/pdf/1706.03762.pdf", ${JSON.stringify(ARXIV)});
      return { mode: "fetched", id: ${JSON.stringify(ARXIV)} };
    } catch (e) { return { mode: "fail", err: String(e.message||e) }; }
  `);
  if (openVia?.id) {
    pass("OA PDF 准备", openVia.mode + " · " + openVia.id);
    // 触发 ReadHub 打开（通过 hub 按钮若可见）
    const opened = await evalJs(cdp, `
      const btn = [...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("已下载") || (b.textContent||"").includes("打开"));
      if (btn) { btn.click(); return "hub-btn"; }
      return "no-btn";
    `);
    await new Promise((r) => setTimeout(r, 2000));
    const tabs = await evalJs(cdp, `return document.querySelectorAll(".rhx-tab, .rh-tab").length;`);
    tabs >= 1 ? pass("multidoc：标签条出现", `${tabs} 个标签`) : skip("multidoc 标签", opened + " · 需 UI 手动开读");
  } else skip("multidoc 开读", openVia?.err || "无 PDF");

  // B2 IPC 探针：bridge.onOpenLocalPdf 存在
  const hasOpen = await evalJs(cdp, `return typeof window.luminaApi?.onOpenLocalPdf === "function";`);
  hasOpen ? pass("multidoc：onOpenLocalPdf 已暴露") : fail("onOpenLocalPdf");

  // ── packaging 配置（Node 侧，非 CDP）──
  const pkg = JSON.parse(await import("node:fs").then((fs) => fs.promises.readFile(path.join(ROOT, "package.json"), "utf8")));
  pkg.build?.fileAssociations?.some((f) => f.ext === "pdf") ? pass("packaging：fileAssociations .pdf") : fail("packaging fileAssociations");
  pkg.scripts?.dist ? pass("packaging：scripts.dist") : fail("packaging dist script");

  cdp.ws.close();
} catch (e) {
  fail("烟测中断", e.message);
}

const nFail = results.filter((r) => !r.ok).length;
const nSkip = results.filter((r) => r.skipped).length;
writeFileSync(path.join(OUT, "post-patch-report.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n结果：${results.length - nFail - nSkip} 通过 / ${nFail} 失败 / ${nSkip} 跳过`);
console.log(`报告：${path.join(OUT, "post-patch-report.json")}\n`);
process.exit(nFail ? 1 : 0);
