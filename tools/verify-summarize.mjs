// lumina-feed · M4 总结管线 行为门（离线，无网络/无真实 LLM）
// 运行：node --experimental-strip-types tools/verify-summarize.mjs
import { anthropicClient, openaiClient, ollamaClient } from "../src/core/summarize/llm-client.ts";
import { buildPrompt, COMBINE_MARKER } from "../src/core/summarize/prompts.ts";
import { isLegitimateOaUrl } from "../src/core/summarize/oa-guard.ts";
import { makeFullTextProvider } from "../src/core/summarize/fulltext.ts";
import { summarizePaper, chunkText } from "../src/core/summarize/summarizer.ts";
import { memoryCache } from "../src/core/summarize/summaries.repo.ts";
import { enrichDigestItems } from "../src/core/summarize/digest-glue.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };

const paper = (over = {}) => ({
  id: "doi:10.1/x", title: "SGLT2 inhibitors in heart failure", abstract: "A randomized trial of 1200 patients showing reduced mortality.",
  authors: ["Lee J"], journal: "NEJM", year: 2026, studyTypes: ["rct"], source: "pubmed",
  isPreprint: false, peerReviewed: true, retracted: false, versions: [], ingestedAt: "2026-06-26", ...over,
});
const OPTS = { source: "abstract_only", fetchPdf: "no", depth: "tldr", language: "zh", scope: "digest_hits" };

// 录制式假 LLM
function fakeLlm() {
  const calls = [];
  const c = {
    id: "fake", model: "test", calls,
    async complete(messages) {
      calls.push(messages);
      const sys = messages.find((m) => m.role === "system")?.content || "";
      const user = messages.find((m) => m.role === "user")?.content || "";
      if (sys.includes(COMBINE_MARKER)) return "FINAL_COMBINED";
      if (user.includes("严格的 JSON")) return '{"purpose":"目的X","methods":"方法Y","results":"结果Z(死亡率↓25%)","conclusion":"有效","limitations":null,"sampleSize":"1200","studyType":"RCT"}';
      return "一句话总结：SGLT2 降低心衰死亡率。";
    },
  };
  return c;
}

// ───────── A. LLM 客户端请求/解析 ─────────
console.log("— A. 可插拔 LLM 客户端（anthropic/openai/ollama） —");
{
  let cap;
  const fa = async (url, init) => { cap = { url, init }; return { ok: true, json: async () => ({ content: [{ type: "text", text: "ANTH_OK" }] }) }; };
  const a = anthropicClient({ model: "claude-x", apiKey: "k-ant" }, { fetchImpl: fa });
  const out = await a.complete([{ role: "system", content: "S" }, { role: "user", content: "U" }], { maxTokens: 50 });
  const body = JSON.parse(cap.init.body);
  ok(cap.url.endsWith("/v1/messages") && cap.init.headers["x-api-key"] === "k-ant" && cap.init.headers["anthropic-version"], "anthropic URL+鉴权头");
  ok(body.system === "S" && body.messages.length === 1 && body.messages[0].role === "user" && out === "ANTH_OK", "anthropic system 分离 + 解析");

  let capo;
  const fo = async (url, init) => { capo = { url, init }; return { ok: true, json: async () => ({ choices: [{ message: { content: "OAI_OK" } }] }) }; };
  const o = openaiClient({ model: "gpt-x", apiKey: "k-oai" }, { fetchImpl: fo });
  const oo = await o.complete([{ role: "user", content: "hi" }]);
  ok(capo.url.endsWith("/v1/chat/completions") && capo.init.headers.authorization === "Bearer k-oai" && oo === "OAI_OK", "openai URL+Bearer+解析");

  let capl;
  const fl = async (url, init) => { capl = { url, init }; return { ok: true, json: async () => ({ message: { content: "OLL_OK" } }) }; };
  const l = ollamaClient({ model: "llama3" }, { fetchImpl: fl, baseUrl: "http://localhost:11434" });
  const ll = await l.complete([{ role: "user", content: "hi" }]);
  const lb = JSON.parse(capl.init.body);
  ok(capl.url.endsWith("/api/chat") && lb.stream === false && ll === "OLL_OK", "ollama 本地端点+解析（不出网）");
  ok(!("authorization" in capl.init.headers), "ollama 无需 key");
}

// ───────── B. Prompt 护栏 ─────────
console.log("— B. Prompt 护栏（反幻觉 / 不越权 / 预印本） —");
{
  const msgs = buildPrompt({ paper: paper(), text: "abc", basisIsFulltext: false, opts: OPTS });
  const sys = msgs[0].content, user = msgs[1].content;
  ok(sys.includes("只依据") && sys.includes("没有的事实"), "护栏:只依据给定文本(反幻觉)");
  ok(sys.includes("纳入/排除") && sys.includes("由研究者自行决定"), "护栏:绝不输出纳入/排除建议(ADR-4)");
  ok(user.includes("一句话") && user.includes("SGLT2 inhibitors in heart failure"), "tldr 指令 + 文献块");
  const pre = buildPrompt({ paper: paper({ isPreprint: true }), text: "abc", basisIsFulltext: false, opts: { ...OPTS, depth: "public" } })[0].content;
  ok(pre.includes("未经同行评议"), "预印本→护栏含未经同行评议");
  const en = buildPrompt({ paper: paper(), text: "abc", basisIsFulltext: false, opts: { ...OPTS, language: "en" } })[0].content;
  ok(en.includes("English"), "语言指令(en)");
  const struct = buildPrompt({ paper: paper(), text: "abc", basisIsFulltext: true, opts: { ...OPTS, depth: "structured" } })[1].content;
  ok(struct.includes("purpose") && struct.includes("严格的 JSON"), "structured→固定 JSON schema 指令");
}

// ───────── C. 源决策 + 全文/摘要回退 ─────────
console.log("— C. 源决策 + 全文/摘要回退（依据徽章） —");
{
  // abstract_only → 基于摘要,LLM 调用一次
  const llm = fakeLlm();
  const r1 = await summarizePaper(paper(), OPTS, { llm });
  ok(r1.sourceBasis === "abstract" && llm.calls.length === 1, "abstract_only→基于摘要,1 次调用");

  // prefer_fulltext + 提供者给全文 → 基于全文
  const llm2 = fakeLlm();
  const ftProvider = { async getFullText() { return { text: "FULLTEXT_BODY: detailed methods and results.", url: "https://www.ncbi.nlm.nih.gov/pmc/x.pdf" }; } };
  const r2 = await summarizePaper(paper(), { ...OPTS, source: "prefer_fulltext", fetchPdf: "if_oa" }, { llm: llm2, fullText: ftProvider });
  ok(r2.sourceBasis === "fulltext", "prefer_fulltext+取到全文→基于全文");

  // prefer_fulltext + 提供者返回 null → 回退摘要 + caveat
  const llm3 = fakeLlm();
  const r3 = await summarizePaper(paper(), { ...OPTS, source: "prefer_fulltext", fetchPdf: "if_oa", depth: "public" }, { llm: llm3, fullText: { async getFullText() { return null; } } });
  ok(r3.sourceBasis === "abstract" && r3.caveats.some((c) => c.includes("未获取到合法 OA 全文")), "全文取不到→回退摘要+徽章");

  // fetchPdf:'no' → 提供者不被调用
  const llm4 = fakeLlm();
  let called = false;
  await summarizePaper(paper(), { ...OPTS, source: "prefer_fulltext", fetchPdf: "no" }, { llm: llm4, fullText: { async getFullText() { called = true; return { text: "x", url: "y" }; } } });
  ok(called === false, "fetchPdf:'no'→不抓全文(提供者未被调用)");

  // none → 跳过,不调用 LLM
  const llm5 = fakeLlm();
  const r5 = await summarizePaper(paper(), { ...OPTS, source: "none" }, { llm: llm5 });
  ok(r5 === null && llm5.calls.length === 0, "source:none→跳过,0 次调用");

  // 预印本 → caveat
  const llm6 = fakeLlm();
  const r6 = await summarizePaper(paper({ isPreprint: true }), OPTS, { llm: llm6 });
  ok(r6.caveats.some((c) => c.includes("未经同行评议")), "预印本→caveat 未经同行评议");
}

// ───────── D. 长全文分块 map-reduce ─────────
console.log("— D. 长全文分块归约 —");
{
  const longText = Array.from({ length: 6 }, (_, i) => `段落${i} ` + "内容".repeat(30)).join("\n\n");
  const chunks = chunkText(longText, 100);
  ok(chunks.length > 1, `分块>1(实得 ${chunks.length})`);
  const llm = fakeLlm();
  const r = await summarizePaper(paper(), { ...OPTS, source: "prefer_fulltext", fetchPdf: "if_oa", depth: "tldr" },
    { llm, fullText: { async getFullText() { return { text: longText, url: "https://arxiv.org/pdf/x.pdf" }; } }, chunkChars: 100, maxChunks: 6 });
  ok(llm.calls.length === chunks.length + 1, `map-reduce 调用数=块数+1(${chunks.length}+1)`);
  ok(r.text === "FINAL_COMBINED" && r.sourceBasis === "fulltext", "reduce 产出最终 + 基于全文");
}

// ───────── E. 缓存 ─────────
console.log("— E. 缓存省 token —");
{
  const llm = fakeLlm();
  const cache = memoryCache();
  const r1 = await summarizePaper(paper(), OPTS, { llm, cache });
  const n1 = llm.calls.length;
  const r2 = await summarizePaper(paper(), OPTS, { llm, cache });
  ok(n1 === 1 && llm.calls.length === 1 && r2.text === r1.text, "二次同参→命中缓存,不再调用 LLM");
}

// ───────── F. structured 解析 + 渲染 ─────────
console.log("— F. structured 解析/渲染 —");
{
  const llm = fakeLlm();
  const r = await summarizePaper(paper(), { ...OPTS, depth: "structured" }, { llm });
  ok(r.structured && r.structured.sampleSize === "1200" && r.structured.studyType === "RCT", "structured JSON 解析为对象");
  ok(r.text.includes("目的") && r.text.includes("样本量"), "structured 渲染为可读文本");
}

// ───────── G. OA 守门(复用红线) ─────────
console.log("— G. 合法 OA 守门 —");
{
  ok(isLegitimateOaUrl("https://sci-hub.se/10.1/x") === false, "拒 Sci-Hub");
  ok(isLegitimateOaUrl("https://libgen.is/x") === false, "拒 LibGen");
  ok(isLegitimateOaUrl("https://annas-archive.org/x") === false, "拒 Anna's Archive");
  ok(isLegitimateOaUrl("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/pdf/x.pdf") === true, "放行 PMC");
  ok(isLegitimateOaUrl("https://arxiv.org/pdf/2606.01234") === true, "放行 arXiv");
  ok(isLegitimateOaUrl("https://example.com/paper.pdf") === true, "放行直链 PDF");
  ok(isLegitimateOaUrl("https://example.com/paywalled") === false, "拒非 OA 非 PDF");

  // 提供者：非法链接 → 不抓 → null
  let fetched = false;
  const prov = makeFullTextProvider({
    resolveOa: () => ["https://sci-hub.se/10.1/x"], // 影子库
    fetchPdf: async () => { fetched = true; return new Uint8Array(); },
    extractText: async () => "x".repeat(1000),
    allowAltSources: false,
  });
  const got = await prov.getFullText(paper());
  ok(got === null && fetched === false, "提供者:影子库链接被守门拦下,未抓取→null");

  // 合法链接 + 足够文本 → 返回
  const prov2 = makeFullTextProvider({
    resolveOa: () => ["https://www.ncbi.nlm.nih.gov/pmc/x.pdf"],
    fetchPdf: async () => new Uint8Array([1, 2, 3]),
    extractText: async () => "正文".repeat(300),
  });
  const got2 = await prov2.getFullText(paper());
  ok(got2 && got2.url.includes("ncbi"), "提供者:合法 OA→返回全文");
}

// ───────── H. digest 接线 + AI 不越权 ─────────
console.log("— H. 接进简报 + AI 不越权(ADR-4) —");
{
  const llm = fakeLlm();
  const papers = { "doi:10.1/x": paper(), "doi:10.1/y": paper({ id: "doi:10.1/y", title: "Other", isPreprint: true }) };
  const items = [
    { id: "doi:10.1/x", title: "SGLT2 inhibitors in heart failure", isPreprint: false },
    { id: "doi:10.1/y", title: "Other", isPreprint: true },
  ];
  const enriched = await enrichDigestItems(items, (id) => papers[id], { ...OPTS, source: "abstract_only" }, { llm });
  ok(enriched[0].tldr && enriched[0].sourceBasis === "abstract", "每条填上 tldr + sourceBasis");
  ok(enriched.every((it) => !("screening" in it) && !("decision" in it) && !("include" in it)), "未写入任何 screening/纳入排除字段(ADR-4)");

  // source:none → 不改 items
  const items2 = [{ id: "doi:10.1/x", title: "x" }];
  await enrichDigestItems(items2, (id) => papers[id], { ...OPTS, source: "none" }, { llm });
  ok(items2[0].tldr === undefined, "source:none→不生成 tldr");
}

// ───────── I. SQLite 缓存（node:sqlite，M4↔M1 存储集成） ─────────
console.log("— I. SQLite 总结缓存（node:sqlite 真表往返） —");
{
  const { openNodeSqlite } = await import("../src/core/store/db.ts");
  const { initStore } = await import("../src/core/store/index.ts");
  const { sqliteSummaryCache } = await import("../src/core/summarize/summaries.repo.ts");
  const store = initStore(await openNodeSqlite(":memory:"));
  const cache = sqliteSummaryCache(store.db);

  const llm = fakeLlm();
  const r1 = await summarizePaper(paper(), { ...OPTS, depth: "structured" }, { llm, cache });
  const n1 = llm.calls.length;
  // 落库行存在且字段正确
  const rowCount = store.db.prepare("SELECT COUNT(*) n FROM summaries").get().n;
  ok(rowCount === 1 && n1 === 1, "总结落 summaries 表(1 行)");
  // 二次同参 → 命中 SQLite 缓存，不再调用 LLM，且 structured/caveats 完整还原
  const r2 = await summarizePaper(paper(), { ...OPTS, depth: "structured" }, { llm, cache });
  ok(llm.calls.length === 1 && r2.text === r1.text, "二次→命中 SQLite 缓存,不再调用 LLM");
  ok(r2.structured && r2.structured.sampleSize === "1200", "缓存往返:structured 完整还原");
  ok(Array.isArray(r2.caveats), "缓存往返:caveats 还原");
  // 依据徽章持久化正确
  const basis = store.db.prepare("SELECT source_basis FROM summaries LIMIT 1").get().source_basis;
  ok(basis === "abstract", "source_basis 持久化正确");
  store.db.close?.();
}



console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
