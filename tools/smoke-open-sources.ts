// tools/smoke-open-sources.ts — 功能 smoke（无网络依赖的引擎逻辑）。
// 运行（apply 后于 repo 根）：tsx tools/smoke-open-sources.ts
// 覆盖：稳定排序消抖、去重键、超时、429 退避/放弃、missing_email、OA 候选抽取。
// （3 个适配器 parse 在制作侧已 22/22 自测；其运行时依赖 searchContext 需仓库构建解析，故此处聚焦无依赖模块。）
import { stableMerge, adoptRanking } from "../src/core/rank/stable-order.ts";
import { dedupeKeyExt } from "../src/core/dedupe-keys.ts";
import { withTimeout, TimeoutError } from "../src/core/sources/with-timeout.ts";
import { fetchWithRetry, installDefaultLimiters, DEFAULT_INTERVALS } from "../src/core/sources/rate-limit.ts";
import { fromZenodo, fromCore, shouldSignalMissingEmail, maybeMissingEmailReason, MISSING_EMAIL } from "../src/core/oa/oa-extended.ts";
import { parseCore } from "../src/core/sources/core.ts";
import { parseHal } from "../src/core/sources/hal.ts";
import { parseDblp } from "../src/core/sources/dblp.ts";
import { parseOsf } from "../src/core/sources/osf-preprints.ts";
import { parseZenodo } from "../src/core/sources/zenodo.ts";
import { parseOpenaire } from "../src/core/sources/openaire.ts";
import { parseSemanticScholar } from "../src/core/sources/semantic-scholar.ts";
import { parseDoaj } from "../src/core/sources/doaj.ts";
import { parseDatacite } from "../src/core/sources/datacite.ts";
import { classifyInput, parseIdentifier } from "../src/core/locate/parse-identifier.ts";
import { jaccard } from "../src/core/locate/enrich-metadata.ts";
import { shouldPrefetchIdentifier, shouldPrefetchOaResult } from "../src/core/locate/prefetch-eligibility.ts";
import { selectAdapters } from "../src/core/sources/index.ts";
import { bm25Rank, parseQuery } from "../src/core/rank/bm25.ts";
import { pickPrimaryHit } from "../src/core/locate/primary-hit.ts";
import { normalize } from "../src/core/normalize.ts";
import { stageTextFromTrace, fetchProgressUi, fetchFailHint } from "../src/ui/fetch-meta.js";
import { pickBestLibgenRow } from "../src/core/oa/alt-sources.ts";
import { extractDoisFromText } from "../src/core/oa/pdf-identity.ts";

let ok = 0, ng = 0;
const t = (n: string, c: boolean) => { console.log((c ? "✓" : "✗") + " " + n); c ? ok++ : ng++; };

// stable-order: C reranks to #1 yet must NOT jump above already-shown A,B (fixes reshuffle F3)
const A = { id: "A" }, B = { id: "B" }, C = { id: "C" }, D = { id: "D" };
const m = stableMerge([A, B], [C, A, B, D]);
t("稳定排序：已显示项保位", m.items.map((x) => x.id).join("") === "ABCD");
t("稳定排序：报告新增数", m.appended === 2);
t("adoptRanking 采纳新序", adoptRanking([C, A]).map((x) => x.id).join("") === "CA");

// dedupe keys (F6)
t("去重键 doi 优先", dedupeKeyExt({ doi: "10.1/X", title: "t", authors: [] } as any) === "doi:10.1/x");
t("去重键 pmid 回退", dedupeKeyExt({ pmid: "777", title: "t", authors: [] } as any) === "pmid:777");
t("去重键 s2 回退", dedupeKeyExt({ s2Id: "S9", title: "t", authors: [] } as any) === "s2:S9");
t("去重键 fp 兜底", /^fp:/.test(dedupeKeyExt({ title: "Some Title", authors: ["Jane Roe"], year: 2020 } as any)));

t("locate: DOI 识别", classifyInput("10.1038/nature12373") === "doi");
t("locate: doi: 前缀", classifyInput("doi:10.1038/nature12373") === "doi");
t("locate: DOI: 大写前缀", classifyInput("DOI:10.1038/nature12373") === "doi");
t("locate: https doi.org", classifyInput("https://doi.org/10.1038/nature12373") === "doi");
t("locate: http dx.doi.org", classifyInput("http://dx.doi.org/10.1038/nature12373") === "doi");
t("locate: PMID 识别", classifyInput("pmid:12345678") === "pmid");
t("locate: arXiv 识别", !!parseIdentifier("2301.00001")?.kind && parseIdentifier("2301.00001")!.kind === "arxiv");
t("locate: 文本非标识符", classifyInput("covid vaccine") === "text");
t("enrich: jaccard 高匹配", jaccard("machine learning transformer", "machine learning transformer") === 1);
t("enrich: jaccard 低匹配", jaccard("covid vaccine efficacy", "deep learning vision") < 0.5);

t("bm25: 子串命中非 title_exact", (() => {
  const pq = parseQuery("covid vaccine efficacy", "title");
  const r = bm25Rank([{ title: "Pfizer COVID vaccine efficacy in children aged 5-11 years." }], pq)[0];
  return r?.matchKind === "title_strong";
})());
t("pickPrimary: covid 子串为 title_strong 主候选", (() => {
  const papers = [{ id: "1", title: "Pfizer COVID vaccine efficacy in children aged 5-11 years." }];
  const hit = pickPrimaryHit(papers, "covid vaccine efficacy");
  return hit?.matchKind === "title_strong" && hit.ambiguous === true;
})());
t("bm25: 整句一致才 title_exact", (() => {
  const q = "covid vaccine efficacy in adults";
  const pq = parseQuery(q, "title");
  const r = bm25Rank([{ title: "COVID vaccine efficacy in adults" }], pq)[0];
  return r?.matchKind === "title_exact";
})());

t("prefetch: 高置信 DOI 可预取", shouldPrefetchIdentifier("identifier", ["crossref"], { doi: "10.1/x" }, { prefetchOnIdentifier: true }, false) === true);
t("prefetch: 默认关不预取", shouldPrefetchIdentifier("identifier", ["crossref"], { doi: "10.1/x" }, {}, false) === false);
t("prefetch: 显式关不预取", shouldPrefetchIdentifier("identifier", ["crossref"], { doi: "10.1/x" }, { prefetchOnIdentifier: false }, false) === false);
t("prefetch: doi_stub 不预取", shouldPrefetchIdentifier("identifier", ["doi_stub"], { doi: "10.1/x" }, { prefetchOnIdentifier: true }, false) === false);
t("prefetch: OA gold 默认不预取", shouldPrefetchOaResult({ doi: "10.1/x", oaStatus: "gold" }, {}, false) === false);
t("prefetch: OA 显式关不预取", shouldPrefetchOaResult({ doi: "10.1/x", oaStatus: "green" }, { prefetchOaResults: false }, false) === false);
t("selectAdapters 尊重 disabled", selectAdapters(undefined, {}, ["zenodo", "libgen"]).every((a) => a.id !== "zenodo" && a.id !== "libgen"));
t("normalize journal 非字符串不抛", (() => { try { normalize({ source: "x", title: "T", authors: [], journal: 123 as any }); return true; } catch { return false; } })());

t("限速表含 19 源默认", Object.keys(DEFAULT_INTERVALS).length >= 19);

t("stageTextFromTrace: 下载步", (stageTextFromTrace([{ id: "download", label: "下载 PDF", status: "running", detail: "arxiv" }]) || "").includes("下载"));
t("stageTextFromTrace: 备用库", (stageTextFromTrace([{ id: "libgen", label: "LibGen", status: "running" }]) || "").includes("备用库"));
t("stageTextFromTrace: 解析 OA", (stageTextFromTrace([{ id: "unpaywall", label: "Unpaywall", status: "running" }]) || "").includes("查找"));
t("fetchProgressUi: trace 优先于计时", fetchProgressUi({ startedAt: Date.now() - 60000, trace: [{ id: "download", label: "下载 PDF", status: "running" }] }).stageText.includes("下载"));
t("fetchFailHint: no_pdf", fetchFailHint("no_pdf").includes("均未成功"));
t("fetchFailHint: publisher_blocked", fetchFailHint("publisher_blocked").includes("浏览器"));
t("fetchFailHint: identity_mismatch", fetchFailHint("identity_mismatch").includes("不一致"));
t("fetchFailHint: timeout", fetchFailHint("download_timeout").includes("超时"));

// P2 adapter parse（样本 JSON，无网络）
t("parseCore doi", parseCore({ results: [{ doi: "10.1/X", title: "T", authors: [{ name: "A" }], downloadUrl: "U" }] })[0]?.doi === "10.1/x");
t("parseHal title", parseHal({ response: { docs: [{ title_s: ["HAL T"], authFullName_s: ["A"] }] } })[0]?.title === "HAL T");
t("parseDblp title", parseDblp({ result: { hits: { hit: [{ info: { title: "DBLP T", authors: { author: "A" }, year: "2024" } }] } } })[0]?.title === "DBLP T");
t("parseOsf preprint", parseOsf({ data: [{ attributes: { title: "OSF T", description: "ab" }, links: {} }] })[0]?.isPreprint === true);
t("parseZenodo hit", parseZenodo({ hits: { hits: [{ metadata: { title: "Z T", creators: [{ name: "A" }] } }] } })[0]?.title === "Z T");
t("parseOpenaire title", parseOpenaire({ response: { results: { result: [{ metadata: { title: [{ $: "OA T" }], creator: [{ name: { $: "A" } }] } }] } } })[0]?.title === "OA T");
t("parseOpenaire oaf entity", parseOpenaire({ response: { results: { result: [{ metadata: { "oaf:entity": { "oaf:result": { title: [{ $: "OAF T" }], pid: { "@classid": "doi", $: "10.1/x" }, creator: [{ $: "B" }] } } } }] } } })[0]?.title === "OAF T");
t("parseS2 s2Id", parseSemanticScholar({ data: [{ paperId: "p1", title: "S2", authors: [] }] })[0]?.s2Id === "p1");
t("parseDoaj gold", parseDoaj({ results: [{ bibjson: { title: "D", author: [{ name: "A" }] } }] })[0]?.oaStatus === "gold");
t("parseDatacite doi", parseDatacite({ data: [{ attributes: { doi: "10.5281/x", titles: [{ title: "DC" }], creators: [] } }] })[0]?.doi === "10.5281/x");

t("pickBestLibgenRow: DOI 精确匹配", (() => {
  const rows = [
    { md5: "a", ext: "pdf", title: "Wrong Paper", doi: "10.1007/s10803-011-1267-0" },
    { md5: "b", ext: "pdf", title: "Biological Motion Perception in Autism", doi: "10.1068/i198" },
  ];
  return pickBestLibgenRow(rows, { expectedDoi: "10.1068/i198", column: "doi" })?.md5 === "b";
})());
t("pickBestLibgenRow: 标题相似拒绝错配", (() => {
  const rows = [
    { md5: "a", ext: "pdf", title: "IQ Predicts Biological Motion Perception in Autism Spectrum Disorders" },
    { md5: "b", ext: "pdf", title: "Biological Motion Perception in Autism" },
  ];
  return pickBestLibgenRow(rows, { expectedTitle: "Biological Motion Perception in Autism", column: "title" })?.md5 === "b";
})());
t("extractDoisFromText", extractDoisFromText("see doi:10.1068/i198 and 10.1007/x").includes("10.1068/i198"));

installDefaultLimiters();

(async () => {
  let timedOut = false;
  try { await withTimeout(new Promise(() => {}), 20); } catch (e) { timedOut = e instanceof TimeoutError; }
  t("withTimeout 挂起即拒", timedOut);
  t("withTimeout 透传快值", (await withTimeout(Promise.resolve(42), 50)) === 42);

  let calls = 0;
  const once429 = (async () => { calls++; return calls === 1 ? new Response("", { status: 429 }) : new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  const r1 = await fetchWithRetry("datacite", "https://x", {}, once429, { baseMs: 3, maxMs: 10 });
  t("fetchWithRetry 429 后重试成功", r1.status === 200 && calls === 2);

  let c2 = 0;
  const always429 = (async () => { c2++; return new Response("", { status: 429 }); }) as unknown as typeof fetch;
  const r2 = await fetchWithRetry("datacite", "https://x", {}, always429, { maxRetries: 2, baseMs: 2, maxMs: 6 });
  t("fetchWithRetry 超限放弃返回 429", r2.status === 429 && c2 === 3);

t("missing_email：有 doi 无邮箱", shouldSignalMissingEmail("10.1/x", undefined) === true);
t("missing_email：有邮箱则否", shouldSignalMissingEmail("10.1/x", "a@b.org") === false);
t("maybeMissingEmail: 出版商拦截不冒充", maybeMissingEmailReason("10.1/x", undefined, "publisher_blocked") === null);
t("maybeMissingEmail: no_pdf 可提示", maybeMissingEmailReason("10.1/x", undefined, "no_pdf") === "missing_email");
t("MISSING_EMAIL 哨兵", MISSING_EMAIL.kind === "missing_email" && MISSING_EMAIL.priority === 999);

  const zf = (async () => new Response(JSON.stringify({ hits: { hits: [{ files: [{ key: "p.pdf", links: { self: "PDFURL" } }] }] } }), { status: 200 })) as unknown as typeof fetch;
  const z = await fromZenodo("10.5281/zenodo.99", zf);
  t("fromZenodo 抽取 PDF 候选", z[0]?.url === "PDFURL" && z[0]?.priority === 24);
  t("fromCore 无 key 优雅跳过", (await fromCore("10.1/x", (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch)).length === 0);

  console.log(`\nsmoke: ${ok} passed, ${ng} failed`);
  process.exit(ng ? 1 : 0);
})();
