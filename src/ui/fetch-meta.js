// Lumina Feed · 多源取文 UI 语义（来源映射 · 阶段文案 · 徽章）
/** @typedef {{ short: string; badgeClass: string; tip: string }} SourceLabel */

export const FETCH_STAGES = [
  "正在检索开放获取来源…",
  "正在尝试备用库镜像…",
  "正在获取 PDF…",
];

export const STAGE_INTERVAL_MS = 8000;

const ALT_TRACE_IDS = new Set(["libgen", "annas", "scihub"]);

function shortTraceDetail(detail) {
  if (!detail) return "";
  const { short } = sourceLabel(detail);
  return short !== "全文" ? short : String(detail).slice(0, 28);
}

/** 由 Fetch Trace 当前 running 步骤生成按钮/徽章阶段文案；无 running 时返回 null */
export function stageTextFromTrace(steps) {
  if (!Array.isArray(steps) || !steps.length) return null;
  const running = steps.filter((s) => s.status === "running");
  const download = running.find((s) => s.id === "download");
  if (download) {
    const d = shortTraceDetail(download.detail);
    return d ? `正在下载 PDF（${d}）…` : "正在下载 PDF…";
  }
  const alt = running.find((s) => ALT_TRACE_IDS.has(s.id));
  if (alt) return `正在尝试备用库（${alt.label}）…`;
  const resolve = running[0];
  if (resolve) {
    if (resolve.id === "identifiers") return "正在解析文献直链…";
    return `正在查找 PDF 链接（${resolve.label}）…`;
  }
  return null;
}

export function fetchFailHint(reason) {
  const r = String(reason || "").toLowerCase();
  if (r === "publisher_blocked") {
    return "已找到官方 PDF 链接，但出版商拦截了程序自动下载。请用下方「浏览器打开」在原文页手动下载。";
  }
  if (r === "identity_mismatch") {
    return "备用库返回的 PDF 与目标文献不一致（DOI/标题校验未通过），已拒绝保存。请换来源或浏览器打开原文。";
  }
  if (r === "no_pdf" || r === "no_oa") return "各来源均未成功下载 PDF（备用库可能暂时不可用）";
  if (/timeout|timed out|超时/.test(r)) return "链接可能可用但下载超时，请稍后重试";
  if (/403|forbidden/.test(r)) return "服务器拒绝自动下载（403），请在浏览器打开原文页";
  if (r === "missing_email") return "请填写联络邮箱以启用 Unpaywall（保存后请重试获取全文）";
  return "";
}

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
  if (s === "scihub" || /sci-?hub/.test(s)) return { short: "Sci-Hub", badgeClass: "ff-b-alt", tip: "经 Sci-Hub 获取（备用库）" };
  if (s === "libgen" || /^libgen/.test(s)) return { short: "LibGen", badgeClass: "ff-b-alt", tip: "经 LibGen 获取（备用库）" };
  if (s === "annas" || /annas/.test(s)) return { short: "Anna's Archive", badgeClass: "ff-b-alt", tip: "经 Anna's Archive 获取（备用库）" };
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
    cached: !!fetchResult.cached,
  };
}

/** 从引擎 papers:hydrate 快照重建 UI 取文徽章 */
export function metaFromAsset(asset) {
  if (!asset || !asset.hasPdf) return null;
  return buildFetchedMeta({ ok: true, source: asset.fetchSource || "cached", cached: true });
}

/** @param {{ startedAt?: number; trace?: Array<{ id: string; label: string; status: string; detail?: string }> }|null|undefined} meta */
export function fetchProgressUi(meta, now = Date.now()) {
  if (!meta || !meta.startedAt) return { stageText: FETCH_STAGES[0], elapsed: 0, stageIndex: 0 };
  const elapsed = Math.max(0, Math.floor((now - meta.startedAt) / 1000));
  const fromTrace = stageTextFromTrace(meta.trace);
  if (fromTrace) {
    let stageIndex = 0;
    if (fromTrace.includes("下载")) stageIndex = 2;
    else if (fromTrace.includes("备用库")) stageIndex = 1;
    return { stageText: fromTrace, elapsed, stageIndex };
  }
  const stageIndex = Math.min(FETCH_STAGES.length - 1, Math.floor((now - meta.startedAt) / STAGE_INTERVAL_MS));
  return { stageText: FETCH_STAGES[stageIndex], elapsed, stageIndex };
}

export function isFetched(meta) {
  return !!(meta && meta.ok);
}

/** 共享 OA / 全文徽章（FindFetch · Library · Subscriptions）— 三态：编目 / 取来中 / 全文就绪 */
export function oaStatusBadge(oa, fetchedMeta, prefix = "ff-b", fetchingMeta = null) {
  if (isFetched(fetchedMeta)) {
    const tier = fetchedMeta.badgeClass || prefix + "-ft";
    const cls = tier.startsWith(prefix) ? tier : tier.replace(/^ff-b-/, prefix + "-");
    const text = fetchedMeta.prefetched ? "全文就绪" : ("全文 · " + (fetchedMeta.label || "已下载"));
    return {
      cls: fetchedMeta.prefetched ? prefix + "-ready" : cls,
      text,
      title: fetchedMeta.tip || (fetchedMeta.prefetched ? "后台预取已完成，可直接阅读" : ""),
    };
  }
  if (fetchingMeta && fetchingMeta.startedAt) {
    const { stageText } = fetchProgressUi(fetchingMeta, Date.now());
    const queued = fetchingMeta.queued && !(fetchingMeta.trace && fetchingMeta.trace.length);
    const tip = fetchingMeta.prefetching
      ? `后台预取 · ${stageText}`
      : queued ? `排队中 · ${stageText}` : stageText;
    return {
      cls: prefix + "-fetching",
      text: queued ? "排队中" : "取来中",
      title: tip,
    };
  }
  if (oa === "gold" || oa === "green") {
    return {
      cls: prefix + "-oa",
      text: oa === "gold" ? "OA 金色 · 编目" : "OA 绿色 · 编目",
      title: "元数据标记开放获取；可一键获取或等待后台预取",
    };
  }
  if (oa === "closed") return { cls: prefix + "-nooa", text: "未标注 OA", title: "元数据未标记开放获取；仍会尝试多源取文" };
  return null;
}

export const ALT_SUMMARY_CAVEAT = "全文来自非出版商渠道——总结请回原文核对。";
