// lumina-feed · 期刊工具烟测（tsx 运行：npx tsx tools/smoke-journal-lookup.mjs）
// 离线：ISSN 归一 / SCImago 解析 / 预警解析 / 合并编排（注入 fake fetch）。
// 在线（best-effort）：OpenAlex 实时查 Nature。
import { normalizeIssn, issnCompact, looksLikeIssn, isValidIssnChecksum } from "../src/core/journal/issn.ts";
import { parseScimagoCsv, scimagoLookup } from "../src/core/journal/scimago.ts";
import { parseWosJifTable, parseWosJifListingHtml, wosJifLookup } from "../src/core/journal/wos-jif.ts";
import { parseCasPartitionTable, parseLetPubListHtml, casPartitionLookup } from "../src/core/journal/cas-partition.ts";
import { parseWarningJson, warningLookup, builtinWarningDataset, isHistoricalWarning } from "../src/core/journal/warning-list.ts";
import { lookupJournal } from "../src/core/journal/lookup.ts";
import { fetchSourceByIssn } from "../src/core/journal/openalex-source.ts";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.error("  ✗", name); } };

console.log("\n  期刊工具烟测\n  " + "─".repeat(40));

// 1) ISSN
ok("normalizeIssn 0028-0836", normalizeIssn("0028 0836") === "0028-0836");
ok("normalizeIssn X 校验位", normalizeIssn("2049-3630") === "2049-3630");
ok("issnCompact", issnCompact("0028-0836") === "00280836");
ok("looksLikeIssn 拒绝刊名", looksLikeIssn("Nature") === false);
ok("isValidIssnChecksum Nature", isValidIssnChecksum("0028-0836") === true);

// 2) SCImago 解析（含逗号小数 + 多 ISSN + 类别分区）
const CSV = [
  'Rank;Sourceid;Title;Type;Issn;SJR;SJR Best Quartile;H index;Total Docs. (2023);Country;Publisher;Categories;Areas',
  '1;28773;Nature;journal;"00280836, 14764687";13,329;Q1;1331;900;United Kingdom;Nature Portfolio;Multidisciplinary (Q1); Multidisciplinary',
  '2;19434;PLoS ONE;journal;19326203;0,839;Q1;435;200;United States;PLOS;Agricultural and Biological Sciences (Q2); Medicine (Q1); Multidisciplinary',
].join("\n");
const ds = parseScimagoCsv(CSV);
ok("SCImago 解析行数", ds.rows.length === 2);
ok("SCImago 年度=2023", ds.year === 2023);
const nat = scimagoLookup(ds, ["0028-0836"]);
ok("SCImago 按 ISSN 命中 Nature", !!nat && nat.title === "Nature");
ok("SCImago SJR 逗号小数=13.329", !!nat && Math.abs((nat.sjr ?? 0) - 13.329) < 1e-6);
ok("SCImago bestQuartile Q1", nat?.bestQuartile === "Q1");
const plos = scimagoLookup(ds, ["1932-6203"]);
ok("SCImago 多学科分区解析", !!plos && (plos.categories?.length ?? 0) >= 2 && plos.categories.some((c) => c.name === "Medicine" && c.quartile === "Q1"));
ok("SCImago 别名 ISSN(14764687) 命中", !!scimagoLookup(ds, ["1476-4687"]));

// 2b) JIF 表格导入 + HTML 列表解析
const JIF_CSV = "ISSN,JIF,Title\n0028-0836,56.1,Nature\n1932-6203,3.2,PLOS ONE\n";
const jifDs = parseWosJifTable(JIF_CSV);
ok("JIF 表格解析 2 条", jifDs.rows.length === 2);
const natJif = wosJifLookup(jifDs, ["0028-0836"]);
ok("JIF 按 ISSN 命中 Nature", !!natJif && natJif.jif === 56.1);
const LIST_HTML = `<div class='title col-4 col-md-3'> ID:</div><div class='content col-8 col-md-9'> #1 </div><div class='title col-4 col-md-3'> Journal Title: </div><div class='content col-8 col-md-9 text-primary'> NATURE </div><div class='title col-4 col-md-3'> ISSN: </div><div class='content col-8 col-md-9'> 0028-0836 </div><div class='title col-4 col-md-3'> eISSN: </div><div class='content col-8 col-md-9'> 1476-4687 </div><div class='title col-4 col-md-3'> Journal Impact Factor (JIF): </div><div class='content col-8 col-md-9'> 56.1 </div><a href='journalid/99'>More</a>`;
const listRows = parseWosJifListingHtml(LIST_HTML, 2026);
ok("JIF HTML 列表解析", listRows.length === 1 && listRows[0].jif === 56.1);

const CAS_CSV = "ISSN,大类分区,大类学科\n0028-0836,1区,综合性期刊\n";
const casDs = parseCasPartitionTable(CAS_CSV);
ok("中科院分区表格 1 条", casDs.rows.length === 1 && casDs.rows[0].majorZone === "1区");
ok("中科院分区 ISSN 命中", casPartitionLookup(casDs, ["0028-0836"])?.majorCategory === "综合性期刊");

// 3) 预警名单
const warn = parseWarningJson([{ title: "Some Predatory Journal", issn: "1234-5679", level: "高", year: 2025 }]);
ok("预警解析 1 条", warn.entries.length === 1);
ok("预警按 ISSN 命中", !!warningLookup(warn, ["1234-5679"], null));
ok("预警按刊名命中", !!warningLookup(warn, [], "some predatory journal"));
ok("预警未命中返回 null", warningLookup(warn, ["0028-0836"], "Nature") === null);

// 3b) 内置中科院 2025 预警名单（5 本）
const builtin = builtinWarningDataset();
ok("内置 2025 名单 5 本", builtin.entries.length === 5);
ok("内置按 ISSN 命中 Wireless Personal Communications", warningLookup(builtin, ["0929-6212"], null)?.title === "Wireless Personal Communications");
ok("内置按刊名命中 Computers & Electrical Engineering", !!warningLookup(builtin, [], "Computers & Electrical Engineering"));
ok("内置年度=2025", builtin.entries.every((e) => e.year === 2025));

// 3c) 多年度合并：当前 vs 历史（官方规则：只最新年度为当前预警）
const multi = parseWarningJson([
  { title: "Journal A", issn: "1111-2220", reason: "论文工厂", year: 2024 },
  { title: "Journal B", issn: "3333-4440", reason: "论文工厂", year: 2025 },
  { title: "Journal A", issn: "1111-2220", reason: "论文工厂", year: 2025 }, // A 连续两年 → 取 2025
]);
ok("多年度去重后 2 本", multi.entries.length === 2);
ok("多年度 maxYear=2025", multi.maxYear === 2025);
const a = warningLookup(multi, ["1111-2220"], null);
ok("A 命中取最新年度 2025", a?.year === 2025);
ok("A 非历史（当前）", isHistoricalWarning(multi, a) === false);
// 仅 2024 命中的历史刊
const histOnly = parseWarningJson([
  { title: "Old Warned", issn: "5555-6660", reason: "论文工厂", year: 2023 },
  { title: "Current", issn: "7777-8880", reason: "论文工厂", year: 2025 },
]);
const oldE = warningLookup(histOnly, ["5555-6660"], null);
ok("历史刊命中 2023", oldE?.year === 2023);
ok("历史刊判定为 historical", isHistoricalWarning(histOnly, oldE) === true);
const curE = warningLookup(histOnly, ["7777-8880"], null);
ok("当前刊非 historical", isHistoricalWarning(histOnly, curE) === false);

// 4) 编排合并（注入 fake fetch，离线）
const fakeSource = {
  id: "https://openalex.org/S137773608",
  display_name: "Nature",
  host_organization_name: "Nature Portfolio",
  homepage_url: "https://www.nature.com/nature/",
  issn_l: "0028-0836",
  issn: ["0028-0836", "1476-4687"],
  is_oa: false,
  is_in_doaj: false,
  works_count: 421000,
  cited_by_count: 20000000,
  summary_stats: { "2yr_mean_citedness": 18.5, h_index: 1331 },
};
const fakeFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (String(url).includes("issn:0028-0836") ? fakeSource : { error: "not found" }),
});
const merged = await lookupJournal("0028-0836", { fetchImpl: fakeFetch, scimago: ds, warning: warn, jif: jifDs, cas: casDs });
ok("编排 ok", merged.ok === true);
ok("编排 类影响因子来自 OpenAlex", merged.impact2yr === 18.5);
ok("编排 合并 JIF", merged.jif?.jif === 56.1);
ok("编排 合并中科院分区", merged.cas?.majorZone === "1区");
ok("编排 合并 SCImago 分区", merged.scimago?.bestQuartile === "Q1");
ok("编排 未预警", merged.warning === null);
ok("编排 provenance 标注 SCImago 年度", merged.provenance?.scimago?.year === 2023);

// 5) 在线 best-effort（不计入失败）
try {
  const live = await fetchSourceByIssn("0028-0836");
  if (live && live.impact2yr != null) console.log("  ◎ [live] OpenAlex Nature 类影响因子 =", live.impact2yr.toFixed(2), "· h =", live.hIndex);
  else console.log("  ◎ [live] OpenAlex 未返回指标（离线/限流，忽略）");
} catch (e) { console.log("  ◎ [live] OpenAlex 跳过：", String(e?.message || e)); }

console.log("  " + "─".repeat(40));
console.log(`  结果：${pass} 通过 · ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
