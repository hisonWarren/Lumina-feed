// lumina-feed · M1 数据底座 行为门（沙箱真跑）
// 运行：node --experimental-strip-types --experimental-sqlite tools/verify-data-core.mjs
import {
  rawToSpec, specToRaw, toPubmedTerm, toCrossrefParams, toOpenalexParams, toEuropePmcQuery, toArxivQuery,
} from "../src/core/querySpec.ts";
import { parsePubmedSummary } from "../src/core/sources/pubmed.ts";
import { parseCrossref } from "../src/core/sources/crossref.ts";
import { parseOpenalex, reconstructAbstract } from "../src/core/sources/openalex.ts";
import { parseEuropePmc } from "../src/core/sources/europepmc.ts";
import { parseArxivAtom } from "../src/core/sources/arxiv.ts";
import { parseBiorxiv } from "../src/core/sources/biorxiv.ts";
import { normalize } from "../src/core/normalize.ts";
import { dedupeAndMerge, dedupeKey, normDoi } from "../src/core/dedupe.ts";
import { aggregateSearch } from "../src/core/aggregate.ts";
import { openNodeSqlite } from "../src/core/store/db.ts";
import { initStore } from "../src/core/store/index.ts";
import { runSubscriptionDigest } from "../src/core/digest.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };

// ───────────── A. QuerySpec 编译 ─────────────
console.log("— A. QuerySpec 双向编译 + 各源翻译 —");
{
  const spec = rawToSpec('"heart failure"[tiab] AND SGLT2[all]', { yearFrom: 2024 });
  ok(spec.groups.length === 2 && spec.groups[0].terms[0].field === "tiab", "raw→spec 解析字段标签");
  const raw = specToRaw(spec);
  ok(raw.includes("heart failure") && raw.includes("AND"), "spec→raw 还原");
  ok(toPubmedTerm(spec).includes("[Title/Abstract]") && toPubmedTerm(spec).includes("Date - Publication"), "PubMed 翻译(字段+年份)");
  ok(toCrossrefParams(spec).get("query.bibliographic")?.includes("SGLT2"), "Crossref 参数");
  ok(toOpenalexParams(spec).get("search")?.includes("heart failure"), "OpenAlex search");
  ok(toEuropePmcQuery(spec).includes("TITLE_ABS:"), "Europe PMC 布尔语法");
  ok(toArxivQuery(spec).includes("abs:"), "arXiv 语法");
}

// ───────────── B. 六源解析(canned) ─────────────
console.log("— B. 六源适配器解析 —");
{
  const pm = parsePubmedSummary({ result: { uids: ["40000001"], "40000001": { title: "A trial.", fulljournalname: "NEJM", sortpubdate: "2026/06/25 00:00", authors: [{ name: "Lee J" }, { name: "Kim S" }], articleids: [{ idtype: "doi", value: "10.1/x" }] } } });
  ok(pm.length === 1 && pm[0].pmid === "40000001" && pm[0].doi === "10.1/x" && pm[0].year === 2026 && pm[0].peerReviewed, "PubMed summary 解析");

  const cr = parseCrossref({ message: { items: [{ DOI: "10.1101/PP", type: "posted-content", subtype: "preprint", title: ["A Preprint"], author: [{ given: "M", family: "Alvarez" }], issued: { "date-parts": [[2026, 6, 26]] }, relation: { "is-preprint-of": [{ id: "10.1/published" }] } }] } });
  ok(cr[0].isPreprint && cr[0].doi === "10.1101/pp" && cr[0].relatedDoi === "10.1/published", "Crossref posted-content→preprint + 关系 DOI");

  ok(reconstructAbstract({ "Hello": [0], "world": [1] }) === "Hello world", "OpenAlex 倒排摘要重建");
  const oa = parseOpenalex({ results: [{ doi: "https://doi.org/10.1/OA", title: "OA paper", authorships: [{ author: { display_name: "Z" } }], primary_location: { source: { display_name: "PLOS" } }, publication_year: 2026, publication_date: "2026-06-20", type: "article", cited_by_count: 7, open_access: { oa_status: "gold", oa_url: "https://oa/x.pdf" }, abstract_inverted_index: { "We": [0], "show": [1] } }] });
  ok(oa[0].doi === "10.1/oa" && oa[0].oaUrl === "https://oa/x.pdf" && oa[0].citationCount === 7 && oa[0].abstract === "We show", "OpenAlex 解析(DOI/OA/被引/摘要)");

  const ep = parseEuropePmc({ resultList: { result: [{ source: "PPR", doi: "10.1/pp2", title: "EPMC preprint", authorString: "A, B", pubYear: "2026", firstPublicationDate: "2026-06-24", pubType: "preprint" }] } });
  ok(ep[0].isPreprint && ep[0].authors.length === 2, "Europe PMC PPR 解析");

  const ax = parseArxivAtom(`<feed><entry><id>http://arxiv.org/abs/2606.01234v2</id><title>Quantum Thing</title><summary>We propose</summary><published>2026-06-22T00:00:00Z</published><author><name>R. Roe</name></author></entry></feed>`);
  ok(ax[0].arxivId === "2606.01234" && ax[0].isPreprint && ax[0].authors[0] === "R. Roe" && ax[0].oaUrl.includes("/pdf/"), "arXiv Atom 解析");

  const bx = parseBiorxiv({ collection: [{ doi: "10.1101/bb", version: "1", title: "Bio preprint", authors: "Doe J; Roe R", date: "2026-06-23", published: "10.1/realpub" }] });
  ok(bx[0].isPreprint && bx[0].relatedDoi === "10.1/realpub" && bx[0].journal === "bioRxiv", "bioRxiv 解析 + published 关系");
}

// ───────────── C. 归一化 + 去重 + 版本归并 ─────────────
console.log("— C. 归一化 / 去重 / 版本归并(N-F3) —");
{
  ok(normDoi("https://doi.org/10.1/AbC") === "10.1/abc", "DOI 规范化");
  ok(dedupeKey({ title: "Same Title", authors: ["Jane Doe"], year: 2026 }) === dedupeKey({ title: "same title!", authors: ["J Doe"], year: 2026 }), "无 DOI 去重键一致(指纹+姓+年)");

  // 跨源同 DOI 合并
  const dupHits = [
    { source: "crossref", doi: "10.1/same", title: "Shared", authors: ["A"], year: 2026, citationCount: 3 },
    { source: "europepmc", doi: "10.1/same", title: "Shared", authors: ["A"], year: 2026, oaUrl: "https://oa/s" },
  ];
  const merged1 = dedupeAndMerge(dupHits.map(normalize));
  ok(merged1.length === 1 && merged1[0].oaUrl === "https://oa/s" && merged1[0].citationCount === 3 && merged1[0].versions.length === 2, "跨源同 DOI→1 条,字段互补,versions=2");

  // preprint ↔ published 版本归并
  const verHits = [
    { source: "crossref", doi: "10.1101/pp", title: "Study X (preprint)", authors: ["B"], year: 2025, isPreprint: true, relatedDoi: "10.1/pub" },
    { source: "crossref", doi: "10.1/pub", title: "Study X", authors: ["B"], year: 2026, isPreprint: false, citationCount: 12 },
  ];
  const merged2 = dedupeAndMerge(verHits.map(normalize));
  ok(merged2.length === 1, "preprint+published→归并为 1 条");
  ok(merged2[0].isPreprint === false && merged2[0].doi === "10.1/pub", "代表取正式发表版");
  ok(merged2[0].versions.length === 2 && merged2[0].versions.some((v) => v.isPreprint), "versions[] 保留 preprint 历史");
}

// ───────────── D. SQLite + FTS5 存储 ─────────────
console.log("— D. SQLite + FTS5 检索 / facet —");
const db = await openNodeSqlite(":memory:");
const store = initStore(db);
{
  const hits = [
    { source: "pubmed", doi: "10.1/a", title: "SGLT2 inhibitors in heart failure", abstract: "reduce mortality and hospitalization", authors: ["Lee J"], year: 2026, pubDate: "2026-06-25", peerReviewed: true, oaUrl: "https://oa/a" },
    { source: "crossref", doi: "10.1/b", title: "Microglia in neuroinflammation", abstract: "single-cell atlas", authors: ["Kim S"], year: 2025, pubDate: "2025-03-10", isPreprint: true },
    { source: "openalex", doi: "10.1/c", title: "Heart failure guideline update", abstract: "ESC recommendations", authors: ["Roe R"], year: 2026, pubDate: "2026-01-15" },
  ];
  store.papers.upsertMany(hits.map(normalize));
  ok(store.papers.count() === 3, "入库 3 条");
  store.papers.upsertMany([normalize(hits[0])]); // 重复 upsert 幂等
  ok(store.papers.count() === 3, "重复 upsert 幂等(仍 3)");

  // FTS5 检索 + snippet + bm25
  const r1 = store.papers.search(rawToSpec("heart failure"), {});
  ok(r1.total === 2 && r1.hits.every((h) => /heart failure/i.test(h.paper.title)), "FTS5 'heart failure' 命中 2");
  ok(r1.hits[0].snippet && /⟦/.test(r1.hits[0].snippet.title || r1.hits[0].snippet.abstract || ""), "snippet 高亮标记存在");
  ok(typeof r1.hits[0].rank === "number" && r1.hits[0].rank < 0, "bm25 rank 存在(负值)");

  // 结构化过滤：仅 2026
  const r2 = store.papers.search({ groups: [], filters: { yearFrom: 2026 } }, {});
  ok(r2.total === 2 && r2.hits.every((h) => h.paper.year === 2026), "年份过滤(2026)→2");

  // 仅 preprint
  const r3 = store.papers.search({ groups: [], filters: { types: ["preprint"] } }, {});
  ok(r3.total === 1 && r3.hits[0].paper.isPreprint, "类型过滤 preprint→1");

  // facet 计数
  const f = store.papers.search({ groups: [], filters: {} }, {}).facets;
  ok(f.source.length === 3 && f.source.every((b) => b.count === 1), "facet 来源 3×1");
  ok(f.year.find((b) => b.value === "2026")?.count === 2, "facet 年份 2026=2");
  ok(f.oa.find((b) => b.value === "open")?.count === 1, "facet OA open=1");
}

// ───────────── E. 多源聚合(部分失败) ─────────────
console.log("— E. 多源聚合 + 部分失败容错 —");
{
  // 路由式假 fetch：按 host 返回各源 canned；openalex 故意 500
  const fake = async (url) => {
    const u = String(url);
    const J = (o) => ({ ok: true, json: async () => o, text: async () => "" });
    if (u.includes("api.crossref.org")) return J({ message: { items: [{ DOI: "10.1/agg", type: "journal-article", title: ["Agg paper"], author: [{ given: "A", family: "B" }], issued: { "date-parts": [[2026, 6, 25]] }, "is-referenced-by-count": 4 }] } });
    if (u.includes("export.arxiv.org")) return { ok: true, text: async () => `<feed><entry><id>http://arxiv.org/abs/2606.99999v1</id><title>Agg preprint</title><summary>x</summary><published>2026-06-25T00:00:00Z</published><author><name>C D</name></author></entry></feed>`, json: async () => ({}) };
    if (u.includes("api.openalex.org")) return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
    return J({});
  };
  const spec = { groups: [{ op: "AND", terms: [{ field: "all", value: "test" }] }], filters: { sources: ["crossref", "arxiv", "openalex"] } };
  const agg = await aggregateSearch(spec, { fetchImpl: fake, since: "2026-06-01" });
  ok(agg.perSource.crossref.ok && agg.perSource.arxiv.ok, "crossref/arxiv 成功");
  ok(agg.perSource.openalex.ok === false && agg.perSource.openalex.error, "openalex 失败被标记(不抛)");
  ok(agg.papers.length === 2, "部分失败仍聚合出 2 条");
}

// ───────────── F. runSubscriptionDigest 端到端 ─────────────
console.log("— F. runSubscriptionDigest 端到端(入库+返回新命中) —");
{
  const before = store.papers.count();
  const fake = async (url) => {
    const u = String(url);
    if (u.includes("api.crossref.org")) return { ok: true, json: async () => ({ message: { items: [{ DOI: "10.1/new1", type: "journal-article", title: ["Fresh result"], author: [{ given: "E", family: "F" }], issued: { "date-parts": [[2026, 6, 26]] } }] } }), text: async () => "" };
    return { ok: true, json: async () => ({}), text: async () => "" };
  };
  const sub = { id: "subA", name: "测试", enabled: true, schedule: { freq: "daily", time: "08:00", tz: "Asia/Shanghai" }, query: { groups: [{ op: "AND", terms: [{ field: "all", value: "fresh" }] }], filters: { sources: ["crossref"] } } };
  const res = await runSubscriptionDigest(sub, "2026-06-01T00:00:00Z", { fetchImpl: fake, store });
  ok(res.items.length === 1 && res.items[0].title === "Fresh result", "返回新命中 DigestItem");
  ok(res.items[0].url === "https://doi.org/10.1/new1", "DigestItem url 回退 doi.org");
  ok(store.papers.count() === before + 1, "新命中已入库");

  // 首跑无 lastRun → since 兜底今天(不抛, 正常返回)
  const res2 = await runSubscriptionDigest(sub, null, { fetchImpl: async () => ({ ok: true, json: async () => ({}), text: async () => "" }), store });
  ok(Array.isArray(res2.items), "首跑 since 兜底今天→正常");
}

// ───────────── G. subscriptions 仓库往返 ─────────────
console.log("— G. subscriptions 仓库往返 —");
{
  const sub = { id: "s9", name: "心梗订阅", enabled: true,
    query: rawToSpec("myocardial infarction AND SGLT2"),
    schedule: { freq: "daily", time: "08:00", tz: "Asia/Shanghai", quietHours: [22, 8] },
    lastRunAt: "2026-06-25T00:00:00Z", seenIds: ["doi:10.1/x"] };
  store.subs.save(sub);
  const got = store.subs.get("s9");
  ok(got && got.name === "心梗订阅" && got.query.groups.length === 2, "订阅存取(含 QuerySpec)");
  ok(got.lastRunAt === "2026-06-25T00:00:00Z" && got.seenIds[0] === "doi:10.1/x", "lastRunAt/seenIds 往返");
  ok(store.subs.list().length === 1, "list 仅含 s9(digest 运行不持久化订阅,由 Scheduler 负责)");
}

db.close?.();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
