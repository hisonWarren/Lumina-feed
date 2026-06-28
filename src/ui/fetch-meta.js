// Lumina Feed · 多源取文 UI 语义（来源映射 · 阶段文案 · 徽章）
/** @typedef {{ short: string; tier: 'oa'|'alt'; badgeClass: string; tip: string }} SourceLabel */

export const FETCH_STAGES = [
  "正在尝试开放获取…",
  "正在搜索备用库…",
  "正在尝试镜像站…",
];

export const STAGE_INTERVAL_MS = 8000;

/** 引擎 source 字段 → 用户语言 */
export function sourceLabel(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return { short: "全文", tier: "oa", badgeClass: "ff-b-ft", tip: "" };
  if (s === "scihub" || /sci-?hub/.test(s)) {
    return { short: "备用库", tier: "alt", badgeClass: "ff-b-alt", tip: "经镜像站获取（Sci-Hub）" };
  }
  if (/libgen|annas|annas_bridge/.test(s)) {
    return { short: "备用库", tier: "alt", badgeClass: "ff-b-alt", tip: "经备用库获取（LibGen / Anna's Archive）" };
  }
  if (/unpaywall|pmc|publisher|openalex|arxiv|europepmc|semantic|crossref|elife|frontiers|plos|paper_oa/.test(s)) {
    return { short: "开放获取", tier: "oa", badgeClass: "ff-b-ft", tip: "经开放获取渠道" };
  }
  return { short: "全文", tier: "oa", badgeClass: "ff-b-ft", tip: raw || "" };
}

export function buildFetchedMeta(fetchResult) {
  if (!fetchResult || !fetchResult.ok) return null;
  const label = sourceLabel(fetchResult.source);
  return {
    ok: true,
    source: fetchResult.source || "",
    label: label.short,
    tier: label.tier,
    badgeClass: label.badgeClass,
    tip: label.tip,
    at: Date.now(),
  };
}

/** @param {{ stageIndex?: number; startedAt?: number }|null|undefined} meta */
export function fetchProgressUi(meta, now = Date.now()) {
  if (!meta || !meta.startedAt) return { stageText: FETCH_STAGES[0], elapsed: 0, stageIndex: 0 };
  const elapsed = Math.max(0, Math.floor((now - meta.startedAt) / 1000));
  const stageIndex = Math.min(FETCH_STAGES.length - 1, Math.floor((now - meta.startedAt) / STAGE_INTERVAL_MS));
  return { stageText: FETCH_STAGES[stageIndex], elapsed, stageIndex };
}

export function isFetched(meta) {
  return !!(meta && meta.ok);
}

/** 共享 OA / 全文徽章（FindFetch · Library · Subscriptions） */
export function oaStatusBadge(oa, fetchedMeta, prefix = "ff-b") {
  if (isFetched(fetchedMeta)) {
    const tier = fetchedMeta.badgeClass || prefix + "-ft";
    const cls = tier.startsWith(prefix) ? tier : tier.replace(/^ff-b-/, prefix + "-");
    return {
      cls,
      text: "全文 · " + (fetchedMeta.label || "已下载"),
      title: fetchedMeta.tip || "",
    };
  }
  if (oa === "gold" || oa === "green") return { cls: prefix + "-oa", text: oa === "gold" ? "OA 金色" : "OA 绿色", title: "" };
  if (oa === "closed") return { cls: prefix + "-nooa", text: "未标注 OA", title: "元数据未标记开放获取；仍会尝试多源取文" };
  return null;
}

export const ALT_SUMMARY_CAVEAT = "全文来自备用库，非出版商原版——总结请回原文核对。";
