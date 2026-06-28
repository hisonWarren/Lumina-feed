// tools/smoke-open-sources.ts — 功能 smoke（无网络依赖的引擎逻辑）。
// 运行（apply 后于 repo 根）：tsx tools/smoke-open-sources.ts
// 覆盖：稳定排序消抖、去重键、超时、429 退避/放弃、missing_email、OA 候选抽取。
// （3 个适配器 parse 在制作侧已 22/22 自测；其运行时依赖 searchContext 需仓库构建解析，故此处聚焦无依赖模块。）
import { stableMerge, adoptRanking } from "../src/core/rank/stable-order.ts";
import { dedupeKeyExt } from "../src/core/dedupe-keys.ts";
import { withTimeout, TimeoutError } from "../src/core/sources/with-timeout.ts";
import { fetchWithRetry, installDefaultLimiters, DEFAULT_INTERVALS } from "../src/core/sources/rate-limit.ts";
import { fromZenodo, fromCore, shouldSignalMissingEmail, MISSING_EMAIL } from "../src/core/oa/oa-extended.ts";
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
import { shouldPrefetchIdentifier } from "../src/core/locate/prefetch-eligibility.ts";
import { selectAdapters } from "../src/core/sources/index.ts";
import { normalize } from "../src/core/normalize.ts";

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
t("locate: PMID 识别", classifyInput("pmid:12345678") === "pmid");
t("locate: arXiv 识别", !!parseIdentifier("2301.00001")?.kind && parseIdentifier("2301.00001")!.kind === "arxiv");
t("locate: 文本非标识符", classifyInput("covid vaccine") === "text");
t("enrich: jaccard 高匹配", jaccard("machine learning transformer", "machine learning transformer") === 1);
t("enrich: jaccard 低匹配", jaccard("covid vaccine efficacy", "deep learning vision") < 0.5);

t("prefetch: 高置信 DOI 可预取", shouldPrefetchIdentifier("identifier", ["crossref"], { doi: "10.1/x" }, { prefetchOnIdentifier: true }, false) === true);
t("prefetch: 默认关不预取", shouldPrefetchIdentifier("identifier", ["crossref"], { doi: "10.1/x" }, {}, false) === false);
t("prefetch: doi_stub 不预取", shouldPrefetchIdentifier("identifier", ["doi_stub"], { doi: "10.1/x" }, { prefetchOnIdentifier: true }, false) === false);
t("selectAdapters 尊重 disabled", selectAdapters(undefined, {}, ["zenodo", "libgen"]).every((a) => a.id !== "zenodo" && a.id !== "libgen"));
t("normalize journal 非字符串不抛", (() => { try { normalize({ source: "x", title: "T", authors: [], journal: 123 as any }); return true; } catch { return false; } })());

t("限速表含 19 源默认", Object.keys(DEFAULT_INTERVALS).length >= 19);

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
  t("MISSING_EMAIL 哨兵", MISSING_EMAIL.kind === "missing_email" && MISSING_EMAIL.priority === 999);

  const zf = (async () => new Response(JSON.stringify({ hits: { hits: [{ files: [{ key: "p.pdf", links: { self: "PDFURL" } }] }] } }), { status: 200 })) as unknown as typeof fetch;
  const z = await fromZenodo("10.5281/zenodo.99", zf);
  t("fromZenodo 抽取 PDF 候选", z[0]?.url === "PDFURL" && z[0]?.priority === 24);
  t("fromCore 无 key 优雅跳过", (await fromCore("10.1/x", (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch)).length === 0);

  console.log(`\nsmoke: ${ok} passed, ${ng} failed`);
  process.exit(ng ? 1 : 0);
})();
