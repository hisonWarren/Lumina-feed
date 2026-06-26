// lumina-feed · 证据可信性 行为门（沙箱真跑）
// 运行：node --experimental-strip-types --experimental-sqlite tools/verify-trust.mjs
import { splitSentences, extractNumbers, numericCores, sourceNumberSet } from "../src/core/trust/segment.ts";
import { groundSummary } from "../src/core/trust/grounding.ts";
import { verifyClaims } from "../src/core/trust/verifier.ts";
import { buildGroundedSummary, annotate } from "../src/core/trust/grounded-summary.ts";
import { saveGrounding, loadGroundings } from "../src/core/trust/audit.ts";
import { summarizeGrounded } from "../src/core/trust/index.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };

const SOURCE =
  "In this randomized controlled trial of 1200 patients with heart failure, SGLT2 inhibitors reduced all-cause mortality by 25% compared with placebo (HR 0.75, p<0.001). Hospitalization for heart failure was also reduced. No significant difference was observed in renal adverse events.";

// ───────── A. 切句 + 数字抽取 ─────────
console.log("— A. 切句 + 数字/统计量抽取 —");
{
  const zh = splitSentences("这是一项随机对照试验。死亡率下降了25%！有意义吗？");
  ok(zh.length === 3, `中文切句=3(实得 ${zh.length})`);
  const en = splitSentences("SGLT2 reduced mortality by 25% (HR 0.75). Hospitalization fell. No renal harm.");
  ok(en.length === 3, `英文切句=3(实得 ${en.length})`);
  const nums = extractNumbers("reduced mortality by 25% (HR 0.75, p<0.001), n=1200");
  ok(nums.some((x) => x.includes("25%")) && nums.some((x) => x.includes("0.75")) && nums.some((x) => x.includes("0.001")) && nums.some((x) => x.includes("1200")), "抽取 25%/0.75/p<0.001/n=1200");
  ok(numericCores("hr0.75").includes("0.75") && numericCores("n=1,200").includes("1200"), "数字本体归一(剥单位/千分位)");
  ok(sourceNumberSet(SOURCE).has("0.75") && sourceNumberSet(SOURCE).has("1200"), "源文数字集合");
}

// ───────── B. 确定性 grounding + 数字核验 ─────────
console.log("— B. 确定性 grounding + 数字核验 —");
{
  const claims = groundSummary(
    "SGLT2 inhibitors reduced all-cause mortality by 25% (HR 0.75, p<0.001). The Eiffel Tower is located in Paris.",
    SOURCE,
  );
  ok(claims[0].status === "grounded" && claims[0].numbersOk, "近原文句→grounded + 数字 OK");
  ok(claims[0].span && SOURCE.includes(claims[0].span.quote) && claims[0].span.quote.length > 0, "支撑片段偏移指向源文(短引用)");
  ok(claims[1].status === "unsupported", "无关句→unsupported");

  // 编造数字 → 强制降级 + 标存疑
  const fab = groundSummary("SGLT2 inhibitors reduced all-cause mortality by 99% compared with placebo.", SOURCE);
  ok(fab[0].numbersOk === false && fab[0].missingNumbers.includes("99"), "编造 99%→数字存疑(missing 含 99)");
  ok(fab[0].status !== "grounded", "数字不符→强制降级(非 grounded)");
}

// ───────── C. 可选 LLM 蕴含校验（不得推翻数字失败） ─────────
console.log("— C. LLM 蕴含校验（升级 weak / 不推翻数字） —");
{
  const fakeJudge = (verdict) => ({ id: "judge", model: "t", async complete() { return verdict; } });
  const weak = [{ text: "The drug lowered death rates.", status: "weak", score: 0.3, span: { start: 0, end: 20, quote: "reduced all-cause mortality by 25%" }, numbersOk: true, missingNumbers: [] }];
  const up = await verifyClaims(weak, { llm: fakeJudge("supported"), statuses: ["weak"] });
  ok(up[0].status === "grounded" && up[0].entailment === "supported", "weak + supported → 升级 grounded");
  const down = await verifyClaims(weak, { llm: fakeJudge("unsupported") });
  ok(down[0].status === "unsupported", "weak + unsupported → 降为 unsupported");

  // ADR-T1：数字失败的 weak 句，即便判 supported 也不得升 grounded
  const badNum = [{ text: "reduced mortality by 99%.", status: "weak", score: 0.4, span: { start: 0, end: 10, quote: "reduced all-cause mortality by 25%" }, numbersOk: false, missingNumbers: ["99"] }];
  const guard = await verifyClaims(badNum, { llm: fakeJudge("supported") });
  ok(guard[0].status === "weak", "数字失败 + supported → 仍 weak(校验器不推翻数字核验)");
}

// ───────── D. GroundedSummary 端到端 + E. 暴露不改写 ─────────
console.log("— D/E. GroundedSummary 端到端 + 暴露不改写 —");
{
  const summary = "SGLT2 inhibitors reduced all-cause mortality by 25% (HR 0.75, p<0.001). Mortality was reduced by 99% in elderly subgroups. The Eiffel Tower is located in Paris.";
  const gs = await buildGroundedSummary(summary, SOURCE);
  ok(gs.claims.length === 3, `切出 3 句(实得 ${gs.claims.length})`);
  ok(gs.claims[0].status === "grounded", "句1 grounded");
  ok(gs.claims[1].numbersOk === false && gs.claims[1].missingNumbers.includes("99"), "句2 数字存疑(99)");
  ok(gs.claims[2].status === "unsupported", "句3 unsupported");
  ok(Math.abs(gs.groundedRatio - 1 / 3) < 0.02, `groundedRatio≈0.33(实得 ${gs.groundedRatio})`);
  ok(gs.flagged.length === 2, "flagged=2(数字存疑 + unsupported)");
  ok(/低 grounding/.test(gs.banner ?? ""), "低 grounding 横幅");
  // 暴露不改写
  ok(gs.text === summary, "原总结未被改写(text 原样)");
  ok(gs.annotated.includes("数字存疑") && gs.annotated.includes("未在原文找到依据"), "标注含两类显眼标记");
  ok(gs.annotated.includes("SGLT2 inhibitors reduced all-cause mortality by 25%"), "grounded 句在标注中保持原样");

  // 撤稿 → 置顶横幅
  const ret = await buildGroundedSummary(summary, SOURCE, { retracted: true });
  ok(ret.retractedWarning && /撤稿/.test(ret.banner ?? "") && ret.banner.startsWith("⛔"), "撤稿→⛔ 置顶横幅");

  // annotate 不改写 grounded 句
  const a = annotate([{ text: "Plain grounded claim.", status: "grounded", score: 0.9, numbersOk: true, missingNumbers: [] }]);
  ok(a === "Plain grounded claim.", "annotate 对 grounded 句零改动");
}

// ───────── F. 审计留痕（node:sqlite，最小留痕） ─────────
console.log("— F. 审计留痕（node:sqlite，偏移+短引用，不存全文） —");
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const gs = await buildGroundedSummary("SGLT2 inhibitors reduced all-cause mortality by 25% (HR 0.75, p<0.001).", SOURCE);
  saveGrounding(db, "doi:10.1/x", "anthropic:claude", "abstract", gs);
  const rows = loadGroundings(db, "doi:10.1/x");
  ok(rows.length === 1 && Math.abs(rows[0].grounded_ratio - gs.groundedRatio) < 1e-9, "落 groundings 表(1 行 + 比例)");
  const storedClaims = JSON.parse(rows[0].claims_json);
  ok(storedClaims[0].span && storedClaims[0].span.quote.length <= 160, "存短引用(≤160)+偏移");
  ok(!rows[0].claims_json.includes("Hospitalization for heart failure was also reduced"), "未存源全文(只短引用)");
  db.close();
}

// ───────── G. 接 M4：summarizeGrounded ─────────
console.log("— G. 接 M4：summarizeGrounded —");
{
  const paper = { id: "doi:10.1/x", title: "SGLT2 in HF", abstract: SOURCE, authors: ["Lee J"], journal: "NEJM", year: 2026, studyTypes: ["rct"], source: "pubmed", isPreprint: false, peerReviewed: true, retracted: false, versions: [], ingestedAt: "2026-06-26" };
  const fakeLlm = { id: "fake", model: "t", async complete() { return "SGLT2 inhibitors reduced all-cause mortality by 25% (HR 0.75, p<0.001)."; } };
  const res = await summarizeGrounded(paper, { source: "abstract_only", fetchPdf: "no", depth: "tldr", language: "en", scope: "digest_hits" }, { llm: fakeLlm });
  ok(res && res.grounded.claims.length >= 1 && res.grounded.claims[0].status === "grounded", "summarizeGrounded:总结→对所用文本 grounding");
  ok(res.grounded.groundedRatio >= 0.99, "全句有依据→groundedRatio≈1");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
