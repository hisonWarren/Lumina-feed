// Lumina Feed · 渲染层 ↔ 真实引擎桥接（patch: wire_live_engine）
// 把散落的 window.luminaApi / luminaOa 收敛到一处，并把真实 Paper/Subscription/Digest
// 适配成 UI 既有组件期望的形状。无 Electron（纯浏览器预览）时 hasBackend()=false，
// 调用方回退 mock，保证演示态仍可运行。

const A = () => (typeof window !== "undefined" ? window.luminaApi : null);
const O = () => (typeof window !== "undefined" ? window.luminaOa : null);

export const hasBackend = () => !!A();

/* ───────── 适配器：真实 Paper → UI 卡片模型 ───────── */
const TYPE_MAP = {
  "meta-analysis": "meta", "systematic-review": "review", "rct": "rct",
  "cohort": "cohort", "case-control": "case", "cross-sectional": "cohort",
  "case-report": "case", "review": "review", "guideline": "review",
  "editorial": "basic", "preprint": "basic", "other": "basic",
};
const mapType = (studyTypes) => {
  const arr = Array.isArray(studyTypes) ? studyTypes : [];
  for (const k of ["meta-analysis", "rct", "systematic-review", "cohort", "case-control", "case-report", "review", "guideline"]) {
    if (arr.includes(k)) return TYPE_MAP[k];
  }
  return TYPE_MAP[arr[0]] || "basic";
};
const mapOa = (s) => (s === "gold" ? "gold" : (s === "green" || s === "hybrid" || s === "bronze") ? "green" : "closed");
const mapLang = (l) => { const s = (l || "").toLowerCase(); return s.startsWith("zh") || s.startsWith("chi") ? "中文" : "英文"; };
const deriveMatched = (query, hay) => {
  if (!query) return [];
  const text = (hay || "").toLowerCase();
  return [...new Set(String(query).toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]{2,}/g) || [])].filter((w) => text.includes(w)).slice(0, 6);
};

/** 真实 Paper（model.ts）→ UI 卡片/抽屉期望的形状 */
export function toCardModel(p, query) {
  const hay = `${p.title || ""} ${p.abstract || ""}`;
  return {
    id: p.id, doi: p.doi, title: p.title || "(无标题)",
    authors: Array.isArray(p.authors) ? p.authors : [],
    journal: p.journal || "", abbr: p.journalAbbrev || p.journal || p.source || "",
    year: p.year || "", pubDate: p.pubDate || "",
    type: mapType(p.studyTypes),
    preprint: !!p.isPreprint, peer: !!p.peerReviewed, retracted: !!p.retracted,
    oa: mapOa(p.oaStatus), oaUrl: p.oaUrl || null,
    cites: p.citationCount || 0, lang: mapLang(p.language), source: p.source || "",
    matched: deriveMatched(query, hay),
    field: (p.keywords && p.keywords[0]) || (p.mesh && p.mesh[0]) || "",
    n: null, tldr: undefined, clinical: null,   // 由总结回填
    abstract: p.abstract || "",
    _live: true,
  };
}

/* ───────── 适配器：UI 订阅 ↔ 真实 Subscription ───────── */
const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

/** UI 订阅 {name,query,sources,freq,time,channels,enabled} → 核心 Subscription */
export function toCoreSub(u) {
  const freq = u.freq === "realtime" ? "hourly" : (u.freq || "daily");
  return {
    id: u.id, name: u.name, enabled: u.enabled !== false,
    query: { raw: u.query || "", sources: u.sources || [], channels: u.channels || ["native"] },
    summarize: u.summarize || undefined,
    schedule: {
      freq, time: u.time || "08:00", tz: localTz(),
      ...(u.freq === "realtime" ? { everyMinutes: 15 } : {}),
    },
  };
}
/** 核心 Subscription → UI 订阅 */
export function fromCoreSub(s) {
  const q = (s && s.query) || {};
  const sch = (s && s.schedule) || {};
  return {
    id: s.id, name: s.name, enabled: s.enabled !== false,
    query: typeof q === "string" ? q : (q.raw || ""),
    sources: q.sources || [], channels: q.channels || ["native"],
    freq: sch.everyMinutes ? "realtime" : (sch.freq || "daily"),
    time: sch.time || "08:00",
    n: 0, spark: [0, 0, 0, 0, 0, 0, 0],
  };
}

/** DigestItem → UI 卡片（轻量，digest 专用） */
export function digestItemToCard(it) {
  return {
    id: it.id, title: it.title || "(无标题)", doi: it.doi,
    authors: it.authors || [], abbr: it.journal || "", journal: it.journal || "",
    year: it.year || "", pubDate: "", type: (it.type && TYPE_MAP[it.type]) || "basic",
    preprint: !!it.isPreprint, peer: !it.isPreprint, retracted: false,
    oa: it.url ? "gold" : "closed", oaUrl: it.url || null, cites: 0, lang: "英文",
    source: it.journal || "", matched: [], field: "",
    n: null, tldr: it.tldr, clinical: null,
    sourceBasis: it.sourceBasis || null, abstract: "", _live: true,
  };
}

/* ───────── API（thin，带 hasBackend 守卫） ───────── */
export const bridge = {
  hasBackend,
  /** 在线聚合检索 → 回填库 → 返回卡片模型数组（依赖 ipc 已扩展 search:online 返回 papers） */
  async searchOnline(raw, filters) {
    const api = A(); if (!api) return null;
    const r = await api.searchOnline(raw, filters);
    const papers = (r && r.papers) || [];
    return { perSource: r && r.perSource, count: (r && r.count) ?? papers.length, papers: papers.map((p) => toCardModel(p, raw)) };
  },
  async searchLocal(spec, opts, raw) {
    const api = A(); if (!api) return null;
    const papers = (await api.searchLocal(spec, opts)) || [];
    return papers.map((p) => toCardModel(p, raw));
  },
  async subsList() {
    const api = A(); if (!api) return null;
    return ((await api.subsList()) || []).map(fromCoreSub);
  },
  async subsSave(uiSub) { const api = A(); if (!api) return null; return api.subsSave(toCoreSub(uiSub)); },
  async subsRemove(id) { const api = A(); if (!api) return null; return api.subsRemove(id); },
  async subsRunNow(id) { const api = A(); if (!api) return null; return api.subsRunNow(id); },
  /** 单篇总结（UI 选项 → SummarizeOptions），返回 {text,sourceBasis,groundedRatio,banner,model} */
  async summarize(paperId, uiOpts) {
    const api = A(); if (!api) return null;
    const opts = {
      source: uiOpts.source || "prefer_fulltext",
      fetchPdf: uiOpts.pdf || uiOpts.fetchPdf || "if_oa",
      depth: uiOpts.depth || "structured",
      language: uiOpts.lang || uiOpts.language || "zh",
      scope: "manual",
    };
    const res = await api.summarizePaper(paperId, opts);
    if (!res) return null;
    const g = res.grounded || {};
    return { text: res.summaryText ?? res.text ?? "", sourceBasis: res.sourceBasis, model: res.model, groundedRatio: g.groundedRatio, banner: g.banner || null };
  },
  async setState(id, patch) { const api = A(); if (!api) return null; return api.setState(id, patch); },
  async exportPapers(ids, format) { const api = A(); if (!api) return null; return api.exportPapers(ids, format); },
  async statsTrends(ids) { const api = A(); if (!api) return null; return api.statsTrends(ids); },
  /** 取合法 OA 全文 PDF：先解析（或用 oaUrl），再经主进程抓取 */
  async fetchFullText(card) {
    const oa = O(); if (!oa) return null;
    let url = card.oaUrl || null;
    if (!url && oa.resolve) url = await oa.resolve(card.id);
    if (!url) return { ok: false, reason: "no_oa" };
    const r = await oa.fetchPdf(url);
    return { ok: !!r && r.ok !== false, url, bytes: r && r.bytes, reason: r && r.reason };
  },
  async getSettings() { const api = A(); if (!api) return null; return api.getSettings(); },
  async saveSettings(s) { const api = A(); if (!api) return null; return api.saveSettings(s); },
  async setSecret(k, v) { const api = A(); if (!api) return null; return api.setSecret(k, v); },
  onDigest(cb) { const api = A(); if (!api || !api.onDigestResult) return () => {}; return api.onDigestResult(cb); },
  tick() { const api = A(); if (!api) return null; return api.tick(); },
};
