// Lumina Feed · 多源取文 UI 语义（来源映射 · 阶段文案 · 徽章）
/** @typedef {{ short: string; badgeClass: string; tip: string }} SourceLabel */

export const FETCH_STAGES = [
  "正在检索来源…",
  "正在尝试镜像…",
  "正在获取 PDF…",
];

export const STAGE_INTERVAL_MS = 8000;

const SOURCE_NAMES = {
  pubmed: "PubMed", europepmc: "Europe PMC", crossref: "Crossref", openalex: "OpenAlex",
  arxiv: "arXiv", biorxiv: "bioRxiv", medrxiv: "medRxiv", semanticscholar: "Semantic Scholar",
  doaj: "DOAJ", datacite: "DataCite", core: "CORE", lens: "Lens.org", hal: "HAL",
  osf: "OSF", zenodo: "Zenodo", openaire: "OpenAIRE", dblp: "DBLP",
  libgen: "LibGen", annas: "Anna's Archive", scihub: "Sci-Hub",
  unpaywall: "Unpaywall", pmc: "PMC", publisher: "出版商", paper_oa: "OA",
  cached: "本机",
};

/** 引擎 source 字段 → 用户语言（USP：各源平等展示） */
export function sourceLabel(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return { short: "全文", badgeClass: "ff-b-ft", tip: "" };
  if (s === "scihub" || /sci-?hub/.test(s)) return { short: "Sci-Hub", badgeClass: "ff-b-ft", tip: "经 Sci-Hub 获取" };
  if (s === "libgen" || /^libgen/.test(s)) return { short: "LibGen", badgeClass: "ff-b-ft", tip: "经 LibGen 获取" };
  if (s === "annas" || /annas/.test(s)) return { short: "Anna's Archive", badgeClass: "ff-b-ft", tip: "经 Anna's Archive 获取" };
  for (const [key, label] of Object.entries(SOURCE_NAMES)) {
    if (s === key || s.includes(key)) return { short: label, badgeClass: "ff-b-ft", tip: `经 ${label} 获取` };
  }
  return { short: "全文", badgeClass: "ff-b-ft", tip: raw || "" };
}

export function buildFetchedMeta(fetchResult, opts = {}) {
  if (!fetchResult || !fetchResult.ok) return null;
  const label = fetchResult.cached
    ? { short: SOURCE_NAMES.cached, badgeClass: "ff-b-ft", tip: "PDF 已在本地" }
    : sourceLabel(fetchResult.source);
  return {
    ok: true,
    source: fetchResult.source || "",
    label: label.short,
    badgeClass: label.badgeClass,
    tip: label.tip,
    at: Date.now(),
    prefetched: !!opts.prefetched,
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
    const text = fetchedMeta.prefetched
      ? "全文就绪"
      : ("全文 · " + (fetchedMeta.label || "已下载"));
    return {
      cls: fetchedMeta.prefetched ? prefix + "-ready" : cls,
      text,
      title: fetchedMeta.tip || (fetchedMeta.prefetched ? "后台预取已完成，可直接阅读" : ""),
    };
  }
  if (oa === "gold" || oa === "green") return { cls: prefix + "-oa", text: oa === "gold" ? "OA 金色" : "OA 绿色", title: "" };
  if (oa === "closed") return { cls: prefix + "-nooa", text: "未标注 OA", title: "元数据未标记开放获取；仍会尝试多源取文" };
  return null;
}

export const ALT_SUMMARY_CAVEAT = "全文来自非出版商渠道——总结请回原文核对。";
