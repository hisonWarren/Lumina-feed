// lumina-feed · M6 导出 行为门
// 运行：node --experimental-strip-types tools/verify-export.mjs
import { toBibtex, splitName } from "../src/core/export/bibtex.ts";
import { toRis, toCsl } from "../src/core/export/csl.ts";
import { exportPapers, trendByYear, countByType, summarize } from "../src/core/export/index.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };

const paper = (over = {}) => ({
  id: "doi:10.1/x", doi: "10.1/abc", title: "SGLT2 inhibitors in heart failure",
  abstract: "A trial.", authors: ["Jane Doe", "Wei Li"], journal: "NEJM", year: 2026,
  volume: "390", issue: "4", pages: "301-310", studyTypes: ["rct"], source: "pubmed",
  isPreprint: false, peerReviewed: true, retracted: false, oaUrl: "https://oa/x.pdf", versions: [], ingestedAt: "2026-06-26", ...over,
});

console.log("— A. BibTeX —");
{
  const b = toBibtex(paper());
  ok(b.startsWith("@article{") && b.includes("title = {SGLT2 inhibitors in heart failure}"), "@article + title");
  ok(b.includes("author = {Doe, Jane and Li, Wei}"), "author 转 Family, Given + and 连接");
  ok(b.includes("journal = {NEJM}") && b.includes("year = 2026") && b.includes("doi = {10.1/abc}"), "journal/year/doi");
  const pre = toBibtex(paper({ isPreprint: true, journal: "bioRxiv" }));
  ok(pre.startsWith("@misc{") && pre.includes("not peer-reviewed"), "preprint→@misc + 未评议 note");
  ok(splitName("Wei Li").family === "Li" && splitName("Wei Li").given === "Wei", "姓名拆分");
}

console.log("— B. RIS —");
{
  const r = toRis(paper());
  ok(r.includes("TY  - JOUR") && r.trim().endsWith("ER  -"), "JOUR + ER 终止");
  ok((r.match(/AU  - /g) ?? []).length === 2, "两位作者各一行 AU");
  ok(r.includes("DO  - 10.1/abc") && r.includes("PY  - 2026"), "DOI + 年份");
  ok(toRis(paper({ isPreprint: true })).includes("TY  - UNPB"), "preprint→UNPB");
}

console.log("— C. CSL-JSON —");
{
  const c = toCsl(paper());
  ok(c.type === "article-journal" && c.title.includes("SGLT2"), "type + title");
  ok(c.author[0].family === "Doe" && c.author[0].given === "Jane", "author family/given");
  ok(JSON.stringify(c.issued) === JSON.stringify({ "date-parts": [[2026]] }) && c.DOI === "10.1/abc", "issued date-parts + DOI");
  ok(toCsl(paper({ isPreprint: true })).type === "manuscript", "preprint→manuscript");
}

console.log("— D. 统一导出 —");
{
  const ps = [paper(), paper({ id: "doi:10.1/y", title: "Other", isPreprint: true })];
  const bib = exportPapers(ps, "bibtex");
  ok(bib.ext === "bib" && bib.mime.includes("bibtex") && (bib.content.match(/@/g) ?? []).length === 2, "bibtex:2 条 + ext/mime");
  ok(exportPapers(ps, "ris").ext === "ris" && exportPapers(ps, "csl-json").ext === "json", "ris/csl 扩展名");
  const csl = JSON.parse(exportPapers(ps, "csl-json").content);
  ok(Array.isArray(csl) && csl.length === 2, "csl-json 可解析为数组");
}

console.log("— E. 趋势统计 —");
{
  const ps = [paper({ year: 2022 }), paper({ year: 2024 }), paper({ year: 2024, isPreprint: true })];
  const t = trendByYear(ps);
  ok(t.length === 3 && t[0].key === "2022" && t[1].count === 0 && t[2].count === 2, "按年时间序列补零(2022..2024)");
  ok(countByType(ps)[0].count === 3, "按类型计数");
  const s = summarize(ps);
  ok(s.total === 3 && s.preprints === 1 && s.openAccess === 3, "汇总计数(total/preprints/OA)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
