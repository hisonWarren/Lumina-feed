// Reader insight blocks: turn flat claims into aspect-oriented sections.
const ASPECT_ORDER = [
  "core_claim",
  "method_rigor",
  "evidence_quality",
  "limitations",
  "boundary_conditions",
  "causal_mechanism",
  "statistical_signal",
  "implications",
  "speculation",
  "other",
];

const ASPECT_LABEL = {
  core_claim: "核心结论",
  method_rigor: "方法与设计",
  evidence_quality: "证据强度",
  limitations: "局限与风险",
  boundary_conditions: "边界条件",
  causal_mechanism: "机制解释",
  statistical_signal: "统计信号",
  implications: "意义与应用",
  speculation: "推测与联想",
  other: "其他要点",
};

function hasAny(text, keys) {
  return keys.some((k) => text.includes(k));
}

function normalizeClaims(rawClaims) {
  if (!Array.isArray(rawClaims)) return [];
  return rawClaims.filter((c) => c && String(c.text || "").trim()).map((c) => ({
    ...c,
    text: String(c.text || "").trim(),
    pageRefs: Array.isArray(c.pageRefs) ? c.pageRefs.filter((p) => Number.isFinite(Number(p)) && Number(p) > 0).map((p) => Number(p)) : [],
  }));
}

function inferAspect(claim, env) {
  const text = String(claim.text || "");
  const kind = String(env?.kind || "");
  const lane = String(env?.lane || "");
  const conf = String(claim.confidence || "");
  const evType = String(claim.evidenceType || "");
  if (kind === "limitations" || hasAny(text, ["局限", "偏差", "威胁", "缺陷", "不足", "confound", "bias"])) return "limitations";
  if (kind === "stats" || hasAny(text, ["p值", "显著", "置信区间", "效应量", "回归", "相关", "统计", "显著性", "power"])) return "statistical_signal";
  if (kind === "hardcore" || hasAny(text, ["机制", "因果", "路径", "中介", "调节", "回路", "神经", "生理"])) return "causal_mechanism";
  if (kind === "recipe" || kind === "repro" || hasAny(text, ["方法", "样本", "设计", "测量", "流程", "复现", "数据处理", "protocol"])) return "method_rigor";
  if (hasAny(text, ["边界", "仅在", "适用于", "条件", "前提", "人群", "场景"])) return "boundary_conditions";
  if (evType === "internal_data" || hasAny(text, ["数据表明", "结果显示", "实验发现"])) return "evidence_quality";
  if (evType === "cites_others" || hasAny(text, ["引用", "文献", "前人研究"])) return "core_claim";
  if (conf === "c3" || kind === "genesis" || lane === "inference") return "speculation";
  if (hasAny(text, ["启示", "应用", "实践", "建议", "意义", "价值"])) return "implications";
  return "other";
}

function bandFor(claims) {
  const vals = claims.map((c) => String(c.confidence || ""));
  if (vals.includes("c3")) return "c3";
  if (vals.includes("c2")) return "c2";
  if (vals.includes("c1")) return "c1";
  return "";
}

function summarizeClaims(claims) {
  if (!claims.length) return "";
  if (claims.length === 1) return claims[0].text;
  const first = claims[0].text;
  const second = claims[1].text;
  return `${first}${second ? `；${second}` : ""}`;
}

export function buildInsightBlocks(env, opts) {
  const maxBlocks = opts?.maxBlocks || 8;
  const maxClaimsPerBlock = opts?.maxClaimsPerBlock || 6;
  const claims = normalizeClaims(env?.claims);
  const grouped = new Map();
  for (const c of claims) {
    const aspect = inferAspect(c, env);
    if (!grouped.has(aspect)) grouped.set(aspect, []);
    grouped.get(aspect).push(c);
  }
  const blocks = [];
  for (const aspect of ASPECT_ORDER) {
    const items = grouped.get(aspect);
    if (!items || !items.length) continue;
    const picked = items.slice(0, maxClaimsPerBlock);
    const refs = [...new Set(picked.flatMap((c) => c.pageRefs || []))].sort((a, b) => a - b);
    blocks.push({
      id: `${aspect}_${blocks.length}`,
      aspect,
      title: ASPECT_LABEL[aspect] || ASPECT_LABEL.other,
      summary: summarizeClaims(picked),
      confidenceBand: bandFor(picked),
      pageRefs: refs,
      claims: picked,
      totalClaims: items.length,
    });
    if (blocks.length >= maxBlocks) break;
  }
  return blocks;
}
