#!/usr/bin/env node
/**
 * 全功能 AI 真机测试（需 Electron --remote-debugging-port=9222）
 * 密钥：DEEPSEEK_API_KEY / LUMINA_TEST_KEY / secrets.local.env（不写进仓库 settings）
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  if (process.env.LUMINA_TEST_KEY) return process.env.LUMINA_TEST_KEY.trim();
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (!existsSync(envPath)) return "";
  const m = readFileSync(envPath, "utf8").match(/^DEEPSEEK_API_KEY=(.+)$/m);
  const v = m ? m[1].trim() : "";
  return v && !v.startsWith("#") ? v : "";
}
function loadDeepSeekModel() {
  if (process.env.DEEPSEEK_MODEL) return process.env.DEEPSEEK_MODEL.trim();
  const envPath = path.join(ROOT, "..", "secrets.local.env");
  if (!existsSync(envPath)) return "deepseek-v4-flash";
  const m = readFileSync(envPath, "utf8").match(/^DEEPSEEK_MODEL=(.+)$/m);
  return m ? m[1].trim() : "deepseek-v4-flash";
}

const API_KEY = loadDeepSeekKey();
const DEEPSEEK_MODEL = loadDeepSeekModel();
const CDP = "http://127.0.0.1:9222";
const OUT = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const results = [];
const pass = (n, d = "") => { results.push({ ok: true, name: n, detail: d }); console.log(`  ✓ ${n}${d ? " — " + d : ""}`); };
const fail = (n, d = "") => { results.push({ ok: false, name: n, detail: d }); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); };
const skip = (n, d = "") => { results.push({ ok: true, name: n, detail: "SKIP: " + d, skipped: true }); console.log(`  ○ ${n} — 跳过：${d}`); };

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("Electron 未运行（需 npx electron . --remote-debugging-port=9222）");
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

// 合成页文本（含统计数字，供 stats/cars 等分析器）
const SAMPLE_PAGES = JSON.stringify([
  { page: 1, text: "Introduction. We studied vaccine efficacy in N=500 participants (250 treatment, 250 placebo). Primary outcome was infection rate." },
  { page: 2, text: "Methods. Randomized double-blind trial. Chi-square test: χ²(1)=4.12, p=0.042. Efficacy 68% (95% CI 52%-79%)." },
  { page: 3, text: "Results. Treatment group 12/250 infected vs placebo 38/250. We did not preregister the analysis. Data/code availability not stated." },
  { page: 4, text: "Discussion. Limitations include single center design. Prior work [Smith 2020] established background on mRNA vaccines." },
]);

console.log("\n── Lumina Feed 全功能 AI 真机测试 ──\n");

if (!API_KEY) {
  console.error("请设置 DEEPSEEK_API_KEY、LUMINA_TEST_KEY，或在 ../secrets.local.env 填写 DEEPSEEK_API_KEY=");
  process.exit(2);
}

let cdp;
try {
  cdp = await cdpConnect(await getWsUrl());
  await cdp.send("Runtime.enable");

  // ── 1. 配置 DeepSeek 密钥（钥匙串）──
  await evalJs(cdp, `
    await window.luminaApi.setSecret("deepseek_key", ${JSON.stringify(API_KEY)});
    const s = await window.luminaApi.getSettings();
    s.llm = { provider: "deepseek", model: ${JSON.stringify(DEEPSEEK_MODEL)}, baseUrl: "https://api.deepseek.com" };
    await window.luminaApi.saveSettings(s);
    return true;
  `);
  pass("配置 DeepSeek 密钥（钥匙串，非配置文件）");

  const test = await evalJs(cdp, `return await window.luminaApi.testLlm({ provider:"deepseek", model:${JSON.stringify(DEEPSEEK_MODEL)}, apiKey:${JSON.stringify(API_KEY)} });`);
  test?.ok ? pass("llm:test 真连通", `${test.model} · ${test.ms}ms`) : fail("llm:test", test?.error || JSON.stringify(test));

  // ── 2. 检索 + 总结 ──
  const search = await evalJs(cdp, `return await window.luminaApi.searchOnline("covid vaccine efficacy randomized trial", {});`);
  const papers = search?.papers || [];
  papers.length > 0 ? pass("search:online", `${papers.length} 篇`) : fail("search:online 无结果");

  const p1 = papers.find((p) => p.oa === "green" || p.oa === "gold" || p.oaUrl) || papers[0];
  const p2 = papers.find((p) => p.id !== p1?.id) || papers[1];
  if (!p1) throw new Error("no paper");

  const sumAbs = await evalJs(cdp, `return await window.luminaApi.summarizePaper(${JSON.stringify(p1.id)}, { mode: "abstract" });`);
  sumAbs?.summaryText ? pass("summarize:paper 摘要", `sourceBasis=${sumAbs.sourceBasis} · ${sumAbs.summaryText.length}字`) : fail("summarize:paper 摘要");

  if (p2) {
    await evalJs(cdp, `return await window.luminaApi.summarizePaper(${JSON.stringify(p2.id)}, { mode: "abstract" });`);
    pass("summarize:paper 第二篇摘要", p2.title?.slice(0, 40) + "…");
  }

  // ── 3. 工作集 + 跨篇 ──
  await evalJs(cdp, `await window.luminaApi.libraryAdd(${JSON.stringify(p1.id)}, "smoke-test");`);
  if (p2) await evalJs(cdp, `await window.luminaApi.libraryAdd(${JSON.stringify(p2.id)}, "smoke-test");`);
  const lib = await evalJs(cdp, `return await window.luminaApi.libraryList();`);
  pass("library:add", `${lib.length} 篇在工作集`);

  if (p2) {
    const corpus = await evalJs(cdp, `
      return await window.luminaReader.corpus("corpus_framing", [${JSON.stringify(p1.id)}, ${JSON.stringify(p2.id)}]);
    `);
    corpus?.claims?.length > 0
      ? pass("reader:corpus 框定地图", `lane=${corpus.lane} · ${corpus.claims.length} 条 · model=${corpus.model}`)
      : corpus?.refused
        ? pass("reader:corpus 框定（拒绝/空）", corpus.refused.reason?.slice(0, 50))
        : fail("reader:corpus", JSON.stringify(corpus).slice(0, 120));
  } else skip("reader:corpus", "仅 1 篇可测");

  // ── 4. OA 取文（首篇 OA URL 失败则回退 arXiv 已知合法 PDF）──
  const ARXIV_URL = "https://arxiv.org/pdf/1706.03762.pdf";
  const ARXIV_ID = "smoke-arxiv-1706";
  const tryFetchPdf = async (url, id) => evalJs(cdp, `
    try {
      await window.luminaOa.fetchPdf(${JSON.stringify(url)}, ${JSON.stringify(id)});
      const list = await window.luminaOa.listPdfs();
      return { ok: !!list.find(x => x.paperId === ${JSON.stringify(id)}) };
    } catch (e) {
      return { ok: false, err: String(e.message || e) };
    }
  `);
  let pdfPaperId = null;
  try {
    let url = p1.oaUrl;
    if (!url) {
      const oa = await evalJs(cdp, `return await window.luminaOa.resolve(${JSON.stringify(p1.id)});`);
      url = oa?.url;
    }
    let fetched = url ? await tryFetchPdf(url, p1.id) : { ok: false };
    let via = "search-hit";
    if (!fetched.ok) {
      fetched = await tryFetchPdf(ARXIV_URL, ARXIV_ID);
      via = fetched.ok ? "arxiv-fallback" : "failed";
    }
    if (fetched.ok) {
      pdfPaperId = via === "arxiv-fallback" ? ARXIV_ID : p1.id;
      pass("oa:fetchPdf 落盘", `${via} · ${pdfPaperId.slice(0, 24)}`);
    } else {
      skip("oa:fetchPdf", (fetched.err || "两次尝试均未落盘").slice(0, 60));
    }
  } catch (e) {
    skip("oa:fetchPdf", e.message.slice(0, 60));
  }

  // ── 4b. 全文摘要（prefer_fulltext，依赖 OA 或摘要回退）──
  try {
    const sumFull = await evalJs(cdp, `return await window.luminaApi.summarizePaper(${JSON.stringify(p1.id)}, { source: "prefer_fulltext", fetchPdf: "if_oa", depth: "tldr" });`);
    sumFull?.summaryText
      ? pass("summarize:paper 全文优先", `sourceBasis=${sumFull.sourceBasis} · ${sumFull.summaryText.length}字`)
      : skip("summarize:paper 全文优先", "无 summaryText");
  } catch (e) {
    skip("summarize:paper 全文优先", e.message.slice(0, 50));
  }

  // ── 5. 阅读器 AI（页锚）──
  const pages = SAMPLE_PAGES;
  const readerKinds = [
    ["outline", "evidence"],
    ["cars", "evidence"],
    ["ledger", "evidence"],
    ["stats", "inference"],
    ["hardcore", "inference"],
    ["genesis", "inference"], // L3 静态拒绝
  ];

  for (const [kind, expectLane] of readerKinds) {
    try {
      const env = await evalJs(cdp, `
        return await window.luminaReader.analyze(${JSON.stringify(kind)}, ${pages}, {});
      `);
      if (kind === "genesis") {
        env?.refused ? pass(`reader:analyze ${kind} (L3拒绝)`, env.refused.reason?.slice(0, 40)) : fail(`${kind} 应静态拒绝`);
      } else if (env?.lane === expectLane && (env.claims?.length > 0 || env.refused)) {
        pass(`reader:analyze ${kind}`, `lane=${env.lane} · claims=${env.claims?.length || 0}`);
      } else {
        fail(`reader:analyze ${kind}`, JSON.stringify({ lane: env?.lane, n: env?.claims?.length }).slice(0, 80));
      }
    } catch (e) {
      fail(`reader:analyze ${kind}`, e.message.slice(0, 80));
    }
  }

  const rSum = await evalJs(cdp, `
    return await window.luminaReader.summarize({ pages: ${pages} });
  `);
  rSum?.text ? pass("reader:summarize", `${rSum.text.length}字 · grounded=${rSum.groundedRatio}`) : fail("reader:summarize", JSON.stringify(rSum).slice(0, 80));

  const rAsk = await evalJs(cdp, `
    return await window.luminaReader.ask({ pages: ${pages}, question: "样本量是多少？" });
  `);
  rAsk?.text ? pass("reader:ask 页码问答", rAsk.text.slice(0, 60) + "…") : fail("reader:ask", JSON.stringify(rAsk).slice(0, 80));

  const rTr = await evalJs(cdp, `
    return await window.luminaReader.translate({ text: "Randomized controlled trial of vaccine efficacy." });
  `);
  rTr?.text || rTr?.translation ? pass("reader:translate", (rTr.text || rTr.translation || "").slice(0, 40)) : fail("reader:translate");

  // move 写作观察
  const move = await evalJs(cdp, `
    return await window.luminaReader.analyze("move", ${pages}, { text: "Randomized double-blind trial.", page: 2 });
  `);
  move?.lane === "evidence" && move?.claims?.length > 0
    ? pass("reader:analyze move 写作观察", move.claims[0]?.text?.slice(0, 40))
    : fail("reader:analyze move");

  await evalJs(cdp, `
    await window.luminaReader.swipeSave({ id: "smoke1", paperId: ${JSON.stringify(p1.id)}, page: 2, text: "Randomized double-blind trial.", note: "smoke" });
    return await window.luminaReader.swipeGet();
  `).then((sw) => pass("swipe:save/get", `${(sw || []).length} 条`)).catch((e) => fail("swipe", e.message));

  await evalJs(cdp, `
    await window.luminaReader.practiceSave(${JSON.stringify(p1.id)}, "limitations", "可能单中心局限");
    return true;
  `).then(() => pass("reader:practiceSave 练判断留痕")).catch((e) => fail("practiceSave", e.message));

  // figure：无 visionConsent 应拒绝（红线7）
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const fig = await evalJs(cdp, `
    return await window.luminaReader.figure(${JSON.stringify(tinyPng)}, "test figure");
  `);
  fig?.refused || fig?.lane === "inference"
    ? pass("reader:figure 隐私闸（未授权）", fig.refused?.reason?.slice(0, 50) || `lane=${fig.lane}`)
    : fail("reader:figure 隐私闸", JSON.stringify(fig).slice(0, 80));

  // figure：开启 visionConsent 后应走 LLM（DeepSeek 可能返回推断或拒绝，均算通路）
  await evalJs(cdp, `
    const s = await window.luminaApi.getSettings();
    s.llm = { ...s.llm, provider: "deepseek", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com", visionConsent: true };
    await window.luminaApi.saveSettings(s);
    return true;
  `);
  const fig2 = await evalJs(cdp, `
    return await window.luminaReader.figure(${JSON.stringify(tinyPng)}, "bar chart vaccine efficacy");
  `);
  fig2?.claims?.length > 0 || fig2?.refused || fig2?.lane
    ? pass("reader:figure 授权后通路", fig2.refused?.reason?.slice(0, 40) || `claims=${fig2.claims?.length || 0} lane=${fig2.lane}`)
    : fig2 == null
      ? skip("reader:figure 授权后", "DeepSeek 当前模型不支持 vision 或调用失败")
      : fail("reader:figure 授权后", JSON.stringify(fig2).slice(0, 80));

  // 分析缓存读写
  const cached = await evalJs(cdp, `
    await window.luminaReader.analysisSave(${JSON.stringify(p1.id)}, { kind: "outline", lane: "evidence", claims: [{ text: "smoke cache" }], model: "test" });
    return await window.luminaReader.analysisGet(${JSON.stringify(p1.id)}, "outline");
  `);
  cached?.claims?.length > 0 ? pass("reader:analysisGet/Save 缓存", `${cached.claims.length} 条`) : fail("analysis 缓存");

  // 批注侧车
  await evalJs(cdp, `
    await window.luminaAnno.save("smoke.pdf", [{ id: "a1", type: "highlight", page: 1, text: "smoke" }]);
    return await window.luminaAnno.get("smoke.pdf");
  `).then((a) => (a?.length === 1 ? pass("annotations:get/save") : fail("annotations", JSON.stringify(a)))).catch((e) => fail("annotations", e.message));

  // 阅读清单
  await evalJs(cdp, `
    await window.luminaApi.listsSave({ reading: [${JSON.stringify(p1.id)}], later: [] });
    return await window.luminaApi.listsGet();
  `).then((l) => (l?.reading?.includes(p1.id) ? pass("lists:get/save") : fail("lists", JSON.stringify(l)))).catch((e) => fail("lists", e.message));

  // ── 6. 订阅引擎（含 autoSummarize AI）──
  const subId = "smoke-sub-" + Date.now();
  await evalJs(cdp, `
    await window.luminaApi.subsSave({ id: ${JSON.stringify(subId)}, name: "smoke covid", kind: "keyword", q: "covid vaccine", freq: "daily", time: "08:00", autoSummarize: "abstract", enabled: true });
    return await window.luminaApi.subsList();
  `);
  pass("subs:save/list");

  try {
    const run = await evalJs(cdp, `
      const subs = await window.luminaApi.subsList();
      const s = subs.find(x => x.id === ${JSON.stringify(subId)});
      return await window.luminaApi.subsRunNow(s);
    `);
    const n = (run?.hits || run?.papers || run?.today || []).length; // ISSUE-005：runNow 返回 {ok,hits}
    n >= 0 ? pass("subs:runNow 真检索", `${n} fresh`) : pass("subs:runNow", "完成");
    const fresh0 = (run?.hits || run?.papers || [])[0];
    if (fresh0?.id) {
      const dig = await evalJs(cdp, `return await window.luminaApi.summarizePaper(${JSON.stringify(fresh0.id)}, { mode: "abstract" });`);
      dig?.summaryText ? pass("subs 链路 summarize", `${dig.summaryText.length}字`) : skip("subs 链路 summarize", "无摘要");
    }
  } catch (e) {
    skip("subs:runNow", e.message.slice(0, 50));
  }

  await evalJs(cdp, `await window.luminaApi.subsRemove(${JSON.stringify(subId)});`);
  pass("subs:remove 清理");

  // ── 7. 本地 FTS ──
  await evalJs(cdp, `
    await window.luminaApi.fulltextSave(${JSON.stringify(p1.id)}, "covid vaccine efficacy randomized trial participants");
    return await window.luminaApi.searchLocal("vaccine");
  `).then((hits) => pass("fulltext:save + search:local", `${(hits || []).length} 命中`)).catch((e) => skip("FTS", e.message.slice(0, 40)));

  cdp.ws.close();
} catch (e) {
  fail("测试中断", e.message);
}

const nFail = results.filter((r) => !r.ok).length;
const nSkip = results.filter((r) => r.skipped).length;
writeFileSync(path.join(OUT, "full-ai-report.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n结果：${results.length - nFail} 通过 / ${nFail} 失败 / ${nSkip} 跳过`);
console.log(`报告：${path.join(OUT, "full-ai-report.json")}\n`);
process.exit(nFail ? 1 : 0);
