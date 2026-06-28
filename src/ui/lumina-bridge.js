// Lumina Feed · 渲染层 ↔ 引擎桥接（干净基线）
const A = () => (typeof window !== "undefined" ? window.luminaApi : null);
const O = () => (typeof window !== "undefined" ? window.luminaOa : null);
const R = () => (typeof window !== "undefined" ? window.luminaReader : null);
const N = () => (typeof window !== "undefined" ? window.luminaAnno : null);
const _annoMem = {}; // 无后端时的会话内回退
const _subsMem = []; // 无后端时的会话内订阅
const _libMem = []; // 无后端时的会话内工作集
const _listsMem = []; // 无后端时的会话内清单

export const hasBackend = () => !!A();

/** 顶栏「订阅简报」徽标：各订阅 today 待展示条数之和 */
export function countSubsBadge(subs) {
  return (Array.isArray(subs) ? subs : []).reduce((n, sub) => {
    if (!sub || sub.enabled === false) return n;
    const today = Array.isArray(sub.today) ? sub.today.filter((p) => p && typeof p === "object") : [];
    return n + today.length;
  }, 0);
}

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
const deriveMatched = (query, hay) => {
  if (!query) return [];
  const text = (hay || "").toLowerCase();
  return [...new Set(String(query).toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]{2,}/g) || [])].filter((w) => text.includes(w)).slice(0, 6);
};

export function toCardModel(p, query) {
  const hay = `${p.title || ""} ${p.abstract || ""}`;
  const hitSources = [...new Set((p.versions || []).map((v) => v.source).filter(Boolean))];
  return {
    id: p.id, doi: p.doi, title: p.title || "(无标题)",
    authors: Array.isArray(p.authors) ? p.authors : [],
    journal: p.journal || "", abbr: p.journalAbbrev || p.journal || p.source || "",
    year: p.year || "", pubDate: p.pubDate || "",
    type: mapType(p.studyTypes),
    preprint: !!p.isPreprint, peer: !!p.peerReviewed, retracted: !!p.retracted,
    oa: mapOa(p.oaStatus), oaUrl: p.oaUrl || null,
    cites: p.citationCount || 0,
    matched: deriveMatched(query, hay),
    abstract: p.abstract || "",
    matchKind: p._matchKind || null,
    isPreprint: !!p.isPreprint,
    peerReviewed: !!p.peerReviewed,
    oaStatus: p.oaStatus || null,
    versions: p.versions || [],
    hitSources,
    digestBlurb: p._digestBlurb || null,
    digestSummary: p._digestSummary || null,
    digestSummaryBasis: p._digestSummaryBasis || null,
    _live: true,
  };
}

function mockReaderSummary() {
  return { text: "（原型模拟·未接后端/未配置密钥）结构化接地总结占位：研究问题 / 方法 / 主要结果 / 结论 / 局限——真实总结会带页码引用 [p.1] 并标「基于全文」。", sourceBasis: "fulltext", model: "mock", groundedRatio: 0, banner: "原型模拟·非真实总结", citations: [{ page: 1 }] };
}
function mockTranslate(text) {
  return "（原型模拟·未接后端/未配置密钥）此处显示译文：" + String(text || "").slice(0, 60) + "…";
}
function mockReaderAnswer(q) {
  return { text: "（原型模拟）就「" + (q || "") + "」——接入大模型与已打开 PDF 文本后，这里会给出带页码引用 [p.1] 的接地回答。", sourceBasis: "fulltext", model: "mock", groundedRatio: 0, banner: "原型模拟·非真实回答", citations: [{ page: 1 }] };
}
let _swipeMem = [];
function mockAnalysisEnvelope(kind) {
  const titles = { outline: "逻辑大纲", cars: "作者论证逻辑（CARS）", ledger: "claim–证据账本", move: "写作观察" };
  if (kind === "move") return { kind: "move", lane: "evidence", groundability: "L1", sourceBasis: "fulltext", model: "mock", title: "写作观察", banner: "原型模拟·未接后端/未配置密钥", framing: "这是对该句修辞功能的标注，不是让你照抄句式；用进稿子请走去 AI 味流程。", claims: [{ text: "原句：「（原型模拟·选中的真实句子会逐字保留）」", pageRefs: [1] }, { text: "这句在做什么：（接入模型后给出修辞功能）", pageRefs: [] }] };
  if (kind === "genesis") return { kind: "genesis", lane: "inference", groundability: "L3", sourceBasis: "external", model: "mock", title: "作者真实的发现过程", refused: { reason: "单篇已发表论文无法还原作者真实的发现过程；论文 Introduction 是事后整理的论证逻辑，不是发现的记录。" }, framing: "如需逼近，只能基于被引脉络 / 该课题组其他论文 / 预印本版本差异做推测，且全程标「推测」。", claims: [] };
  if (kind === "hardcore" || kind === "limitations") return { kind, lane: "inference", groundability: kind === "limitations" ? "L2" : "L1", sourceBasis: "fulltext", model: "mock", title: kind === "hardcore" ? "硬核 / 保护带分解" : "作者未言明的局限", banner: "原型模拟·未接后端/未配置密钥", framing: kind === "hardcore" ? "这是 AI 基于研究纲领方法论（Lakatos）的推断分层，作者并未如此区分。" : undefined, claims: [{ text: "（原型模拟·接入模型后给出推断；推断车道、需回原文核对）", pageRefs: [], confidence: kind === "limitations" ? "c2" : "c1" }] };
  if (kind === "figure") return { kind: "figure", lane: "inference", groundability: "L2", sourceBasis: "fulltext+vision", model: "mock", title: "图表分析", banner: "原型模拟·未接视觉模型", framing: "以下基于图像的视觉特征；制作工具无法从静态图确证。", claims: [{ text: "可观察风格：（接入视觉模型后给出 图型/配色/坐标/误差表达 等标签）", pageRefs: [], confidence: "c1" }, { text: "制作工具推测：无法从静态图确证（仅供复刻风格参考）", pageRefs: [], confidence: "c3", flag: "needs_recheck" }] };
  if (kind === "stats") return { kind: "stats", lane: "inference", groundability: "L2", sourceBasis: "fulltext", model: "mock", title: "统计一致性扫描", banner: "原型模拟·未接后端/未配置密钥", framing: "这是 AI 对可能不一致的提示，不是判定出错；AI 无法核验算术，请手动复核或用 statcheck/GRIM 重算。", claims: [{ text: "（原型模拟·接入模型后给出「看起来需复核」的提示，绝不断言出错）", pageRefs: [], confidence: "c3", flag: "needs_recheck" }] };
  if (kind === "flowmap") return { kind: "flowmap", lane: "inference", groundability: "L2", sourceBasis: "fulltext", model: "mock", title: "方法 / 逻辑流程图", banner: "原型模拟·未接后端/未配置密钥", framing: "这是 AI 从正文方法描述重建的流程图（推断车道）：节点标注页码、点击回原文核对；箭头是 AI 解读的步骤依赖，非原文断言。", graph: { nodes: [{ id: "a", label: "研究对象 / 数据", pageRefs: [1] }, { id: "b", label: "预处理 / 分组", pageRefs: [2] }, { id: "c", label: "建模 / 干预", pageRefs: [2] }, { id: "d", label: "评测 / 统计", pageRefs: [3] }, { id: "e", label: "主要结论（示例·无页码依据）", pageRefs: [] }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "e", label: "得出" }] }, claims: [] };
  return {
    kind: kind || "outline", lane: "evidence", groundability: "L0", sourceBasis: "fulltext", model: "mock",
    title: titles[kind] || "分析", banner: "原型模拟·未接后端/未配置密钥",
    claims: [
      { text: "（原型模拟）背景：真实结果会从正文抽取，每条带页码可回原文核对", pageRefs: [1] },
      { text: "（原型模拟）方法 → 结果 → 结论的逻辑骨架", pageRefs: [2] },
    ],
  };
}

export const bridge = {
  hasBackend,
  async searchOnline(raw, filters) {
    const api = A(); if (!api) return null;
    const r = await api.searchOnline(raw, filters);
    const papers = (r && r.papers) || [];
    return {
      perSource: r && r.perSource,
      count: (r && r.count) ?? papers.length,
      papers: papers.map((p) => toCardModel(p, raw)),
      locateMode: r && r.locateMode,
      resolvedFrom: r && r.resolvedFrom,
      resolveError: r && r.resolveError,
    };
  },
  async resolveIdentifier(raw) {
    const api = A(); if (!api || !api.resolveIdentifier) return null;
    const r = await api.resolveIdentifier(raw);
    if (!r || !r.ok) return r;
    return { ...r, paper: r.paper ? toCardModel(r.paper, raw) : null };
  },
  async searchRetrySource(sourceId, raw, filters) {
    const api = A(); if (!api || !api.searchRetrySource) return null;
    const r = await api.searchRetrySource(sourceId, raw, filters);
    if (!r) return null;
    const papers = (r.papers || []).map((p) => toCardModel(p, raw));
    return { ...r, papers };
  },
  async summarize(paperId, uiOpts) {
    const api = A(); if (!api) return null;
    const opts = {
      source: uiOpts.source || (uiOpts.scope === "digest_hits" ? "abstract_only" : "prefer_fulltext"),
      fetchPdf: uiOpts.pdf || uiOpts.fetchPdf || (uiOpts.scope === "digest_hits" ? "no" : "if_oa"),
      depth: uiOpts.depth === "brief" ? "tldr" : (uiOpts.depth || "tldr"),
      language: uiOpts.lang || uiOpts.language || "zh",
      scope: uiOpts.scope || "manual",
    };
    const res = await api.summarizePaper(paperId, opts);
    if (!res) return null;
    const g = res.grounded || {};
    return { text: res.summaryText ?? res.text ?? "", summaryText: res.summaryText ?? res.text ?? "", sourceBasis: res.sourceBasis, model: res.model, groundedRatio: g.groundedRatio, banner: g.banner || null };
  },
  async getCachedSummary(paperId, uiOpts = {}) {
    const api = A(); if (!api || !api.getCachedSummary) return null;
    try {
      const depth = uiOpts.depth === "brief" ? "tldr" : (uiOpts.depth || "tldr");
      return await api.getCachedSummary(paperId, depth, uiOpts.language || "zh");
    } catch { return null; }
  },
  async fetchFullText(card, onProgress, ctx = {}) {
    const oa = O(); if (!oa) return null;
    const fetchCtx = {
      provenance: ctx.provenance || "find_fetch",
      channel: ctx.channel || "manual",
    };
    if (oa.fetchPaperStream && card.id) {
      const reqId = Date.now();
      return new Promise((resolve) => {
        let settled = false;
        const finish = (r) => {
          if (settled) return;
          settled = true;
          stop && stop();
          if (r && r.ok) resolve({ ok: true, url: r.url, bytes: r.bytes, source: r.source, cached: !!r.cached });
          else resolve({ ok: false, reason: (r && r.reason) || "no_pdf" });
        };
        const stop = oa.fetchPaperStream(card.id, reqId, (ev) => {
          if (ev && ev.steps && onProgress) onProgress(ev);
          if (ev && ev.type === "final" && ev.result) finish(ev.result);
        }, fetchCtx);
      });
    }
    if (oa.fetchPaper && card.id) {
      try {
        const r = await oa.fetchPaper(card.id, fetchCtx);
        if (r && r.ok) return { ok: true, url: r.url, bytes: r.bytes, source: r.source, cached: !!r.cached };
        return { ok: false, reason: (r && r.reason) || "no_pdf" };
      } catch (e) {
        return { ok: false, reason: (e && e.message) || "fetch_failed" };
      }
    }
    let url = card.oaUrl || null;
    if (!url && oa.resolve) url = await oa.resolve(card.id);
    if (!url) return { ok: false, reason: "no_oa" };
    try {
      const r = await oa.fetchPdf(url, card.id);
      const bytes = r instanceof Uint8Array ? r : (r && r.bytes);
      if (bytes && bytes.byteLength) return { ok: true, url, bytes };
      return { ok: false, url, reason: (r && r.reason) || "fetch_failed" };
    } catch (e) {
      return { ok: false, url, reason: (e && e.message) || "fetch_failed" };
    }
  },
  probeMirrors() {
    const oa = O(); if (!oa || !oa.probeMirrors) return Promise.resolve(null);
    return oa.probeMirrors();
  },
  onPrefetchStart(cb) {
    const oa = O(); if (!oa || !oa.onPrefetchStart) return () => {};
    return oa.onPrefetchStart(cb);
  },
  onPrefetchDone(cb) {
    const oa = O(); if (!oa || !oa.onPrefetchDone) return () => {};
    return oa.onPrefetchDone(cb);
  },
  onPrefetchFail(cb) {
    const oa = O(); if (!oa || !oa.onPrefetchFail) return () => {};
    return oa.onPrefetchFail(cb);
  },
  async readerSummarize(pages) {
    const r = R(); if (!r || !r.summarize) return mockReaderSummary();
    return r.summarize({ pages });
  },
  async readerAsk(pages, question) {
    const r = R(); if (!r || !r.ask) return mockReaderAnswer(question);
    return r.ask({ pages, question });
  },
  async readerTranslate(text) {
    const r = R();
    if (!r || !r.translate) return { ok: false, error: "未连接本地引擎，无法翻译", text: mockTranslate(text) };
    try {
      const res = await r.translate({ text });
      if (res && res.ok === false) return { ok: false, error: res.error || "翻译失败", text: "" };
      return { ok: true, text: (res && res.text) || "", model: res && res.model };
    } catch (e) { return { ok: false, error: (e && e.message) || "翻译失败", text: "" }; }
  },
  async llmReady() {
    const api = A();
    if (!api || !api.llmStatus) return { ok: false, message: "未连接引擎" };
    try { return await api.llmStatus(); } catch { return { ok: false, message: "无法读取大模型配置" }; }
  },
  async readerAnalyze(kind, pages, opts) {
    const r = R(); if (!r || !r.analyze) return mockAnalysisEnvelope(kind); // 无引擎：返回结构合法的占位信封（标「原型模拟」），不伪造接地
    try { return await r.analyze(kind, pages, opts); } catch (e) { return { kind, lane: "inference", groundability: "L2", sourceBasis: "fulltext", model: "(none)", title: "分析", refused: { reason: "分析失败（" + ((e && e.message) || "通道错误") + "），请重试。" }, claims: [] }; }
  },
  async swipeGet() {
    const r = R(); if (!r || !r.swipeGet) return _swipeMem.slice();
    try { return (await r.swipeGet()) || []; } catch (e) { return []; }
  },
  async swipeSave(item) {
    const r = R(); if (!r || !r.swipeSave) { _swipeMem.unshift({ ...item, id: item.id || ("sw" + Date.now()) }); return true; }
    try { return await r.swipeSave(item); } catch (e) { return false; }
  },
  async swipeRemove(id) {
    const r = R(); if (!r || !r.swipeRemove) { _swipeMem = _swipeMem.filter((x) => x.id !== id); return true; }
    try { return await r.swipeRemove(id); } catch (e) { return false; }
  },
  async readerPracticeSave(paperId, kind, text) {
    const r = R(); if (!r || !r.practiceSave || !paperId) return false; // 无引擎：不伪造留痕
    try { return await r.practiceSave(paperId, kind, text); } catch (e) { return false; }
  },
  async readerFigure(dataUrl, caption) {
    const r = R(); if (!r || !r.figure) return mockAnalysisEnvelope("figure"); // 无引擎：占位（标原型模拟）
    try { return await r.figure(dataUrl, caption); } catch (e) { return { kind: "figure", lane: "inference", groundability: "L2", sourceBasis: "fulltext+vision", model: "(none)", title: "图表分析", refused: { reason: "图表分析失败（" + ((e && e.message) || "通道错误") + "）。纯文本云端模型（如 deepseek-v4-flash）无法读图，请改用 Ollama 视觉模型或 OpenAI/Anthropic 视觉模型。" }, claims: [] }; }
  },
  async readerCorpus(kind, paperIds) {
    const r = R();
    if (!r || !r.corpus) { // 无引擎：占位（标原型模拟），不伪造跨篇结论
      const inf = kind !== "corpus_recipe";
      const title = kind === "corpus_contradiction" ? "矛盾发现" : kind === "corpus_recipe" ? "方法配方汇编" : "主流框定地图";
      return { kind, lane: inf ? "inference" : "evidence", groundability: inf ? "L2" : "L1", sourceBasis: "corpus", model: "mock", title, banner: "原型模拟·未接后端/未配置密钥", framing: inf ? "这是跨文本归纳，非任一篇原文事实；请回各篇核对。" : "这是方法汇编，逐条注明出处；请回各篇原文核对。", claims: [{ text: "（原型模拟·接入模型后给出跨篇结果，带涉及文献）", pageRefs: [], paperRefs: ["示例文献 A", "示例文献 B"], confidence: inf ? "c2" : undefined }] };
    }
    try { return await r.corpus(kind, paperIds); } catch (e) { return { kind, lane: "inference", groundability: "L2", sourceBasis: "corpus", model: "(none)", title: "跨篇分析", refused: { reason: "跨篇分析失败（" + ((e && e.message) || "通道错误") + "），请重试。" }, claims: [] }; }
  },
  async readerAnalysisGet(paperId, kind) {
    const r = R(); if (!r || !r.analysisGet || !paperId) return null;
    try { return await r.analysisGet(paperId, kind); } catch (e) { return null; }
  },
  async readerAnalysisSave(paperId, env) {
    const r = R(); if (!r || !r.analysisSave || !paperId || !env) return false;
    try { return await r.analysisSave(paperId, env); } catch (e) { return false; }
  },
  async getAnnotations(docKey) {
    const n = N(); if (!n || !n.get) return _annoMem[docKey] || [];
    try { return (await n.get(docKey)) || []; } catch (e) { return []; }
  },
  async saveAnnotations(docKey, list) {
    const n = N(); if (!n || !n.save) { _annoMem[docKey] = list; return true; }
    try { return await n.save(docKey, list); } catch (e) { return false; }
  },
  async readPdf(paperId) {
    const oa = O(); if (!oa || !oa.readPdf) return null;
    return oa.readPdf(paperId);
  },
  async listDownloaded() {
    const oa = O(); if (!oa || !oa.listPdfs) return [];
    try { return (await oa.listPdfs()) || []; } catch { return []; }
  },
  async subsList() {
    const api = A(); if (!api || !api.subsList) return _subsMem.slice();
    try {
      const list = (await api.subsList()) || [];
      return list.map((sb) => ({ ...sb, today: (sb.today || []).map((p) => toCardModel(p, sb.q || "")) })); // 引擎持久化 today(引擎 Paper) → 卡片形状
    } catch (e) { return _subsMem.slice(); }
  },
  async subsSave(sub) {
    const api = A();
    if (!api || !api.subsSave) { const i = _subsMem.findIndex((x) => x.id === sub.id); if (i >= 0) _subsMem[i] = sub; else _subsMem.push(sub); return sub; }
    try { return (await api.subsSave(sub)) || sub; } catch (e) { return sub; }
  },
  async subsRemove(id) {
    const api = A();
    if (!api || !api.subsRemove) { const i = _subsMem.findIndex((x) => x.id === id); if (i >= 0) _subsMem.splice(i, 1); return true; }
    try { return await api.subsRemove(id); } catch (e) { return false; }
  },
  onSubsUpdated(cb) {
    const api = A(); if (!api || !api.onSubsUpdated) return () => {};
    return api.onSubsUpdated(() => { try { cb(); } catch { /* ignore */ } });
  },
  async subsRunNow(sub, opts = {}) {
    const api = A(); if (!api || !api.subsRunNow) return { ok: false, mock: true, hits: [] };
    const q = (sub && sub.q) || "";
    let stopProgress = null;
    let stopUpdated = null;
    if (api.onSubsProgress && opts.onProgress) {
      stopProgress = api.onSubsProgress(opts.onProgress);
    }
    if (api.onSubsUpdated && opts.onUpdated) {
      stopUpdated = api.onSubsUpdated(opts.onUpdated);
    }
    try {
      const r = (await api.subsRunNow(sub, { asyncAi: opts.asyncAi !== false })) || { ok: true, hits: [] };
      return { ...r, hits: (r.hits || []).map((p) => toCardModel(p, q)) };
    } catch (e) { return { ok: false, hits: [] }; }
    finally {
      if (stopProgress) stopProgress();
      if (stopUpdated) stopUpdated();
    }
  },
  async subsPreview(draft) {
    const api = A(); if (!api || !api.subsPreview) return { ok: false, hits: [], preview: true };
    try {
      const r = (await api.subsPreview(draft)) || { ok: true, hits: [], preview: true };
      const q = draft?.q || draft?.journal?.name || "";
      return { ...r, hits: (r.hits || []).map((p) => toCardModel(p, q)) };
    } catch (e) { return { ok: false, hits: [], preview: true }; }
  },
  async libraryList() {
    const api = A(); if (!api || !api.libraryList) return _libMem.slice();
    try {
      const rows = (await api.libraryList()) || [];
      return rows.map((r) => ({
        ...toCardModel(r.paper, ""),
        provenance: r.provenance,
        _fetched: !!r.hasFull,
        fetchSource: r.fetchSource || null,
        fetchedAt: r.fetchedAt || null,
        hasSummary: !!r.hasSummary,
        summary: r.summaryText || "",
        annoCount: r.annoCount || 0,
        annoText: r.annoText || "",
      }));
    } catch (e) { return _libMem.slice(); }
  },
  async libraryAdd(paper, provenance) {
    const api = A(); if (!api || !api.libraryAdd) { if (!_libMem.some((x) => x.id === paper.id)) _libMem.push({ ...paper, provenance: provenance || "find_fetch" }); return true; }
    try { return await api.libraryAdd(paper.id, provenance || "find_fetch"); } catch (e) { return false; }
  },
  async libraryRemove(paperId) {
    const api = A(); if (!api || !api.libraryRemove) { const i = _libMem.findIndex((x) => x.id === paperId); if (i >= 0) _libMem.splice(i, 1); return true; }
    try { return await api.libraryRemove(paperId); } catch (e) { return false; }
  },
  async pdfDelete(paperId, opts = {}) {
    const api = A(); if (!api || !api.pdfDelete) return false;
    try { return await api.pdfDelete(paperId, opts); } catch { return false; }
  },
  async hydratePaperAssets() {
    const api = A(); if (!api || !api.papersHydrate) return {};
    try { return (await api.papersHydrate()) || {}; } catch { return {}; }
  },
  async reconcileOrphans() {
    const api = A(); if (!api || !api.papersReconcile) return { added: 0 };
    try { return (await api.papersReconcile()) || { added: 0 }; } catch { return { added: 0 }; }
  },
  async enqueueFetch(jobs) {
    const api = A(); if (!api || !api.papersEnqueueFetch) return { queued: 0 };
    try { return (await api.papersEnqueueFetch(jobs)) || { queued: 0 }; } catch { return { queued: 0 }; }
  },
  onPapersChanged(cb) {
    const api = A(); if (!api || !api.onPapersChanged) return () => {};
    return api.onPapersChanged(() => { try { cb(); } catch { /* ignore */ } });
  },
  onFetchQueue(cb) {
    const api = A(); if (!api || !api.onFetchQueue) return () => {};
    return api.onFetchQueue((p) => { try { cb(p); } catch { /* ignore */ } });
  },
  async listsGet() {
    const api = A(); if (!api || !api.listsGet) return _listsMem.slice();
    try { return (await api.listsGet()) || []; } catch (e) { return _listsMem.slice(); }
  },
  async listsSave(lists) {
    const api = A(); if (!api || !api.listsSave) { _listsMem.length = 0; (lists || []).forEach((l) => _listsMem.push(l)); return true; }
    try { return await api.listsSave(lists); } catch (e) { return false; }
  },
  async indexFullText(paperId, text) {
    const api = A(); if (!api || !api.fulltextSave || !paperId || !text) return false; // 无引擎：不索引（正文 FTS 属引擎能力）
    try { return await api.fulltextSave(paperId, String(text)); } catch (e) { return false; }
  },
  async searchLocal(query) {
    const api = A(); if (!api || !api.searchLocal) return []; // 无引擎：正文检索返回空（仍有客户端元数据/总结/批注命中）
    try { return (await api.searchLocal(query)) || []; } catch (e) { return []; }
  },
  async getSettings() { const api = A(); if (!api) return null; return api.getSettings(); },
  async listModels(cfg) {
    const api = A();
    if (!api || !api.listModels) return { ok: false, error: "未连接本地引擎，无法拉取模型列表" };
    try { return await api.listModels(cfg); } catch (e) { return { ok: false, error: "拉取失败" }; }
  },
  async getTranslations(docKey) {
    const r = R(); if (!r || !r.getTranslations || !docKey) return {};
    try { return (await r.getTranslations(docKey)) || {}; } catch (e) { return {}; }
  },
  async saveTranslation(docKey, page, model, text) {
    const r = R(); if (!r || !r.saveTranslation || !docKey) return false;
    try { return await r.saveTranslation(docKey, page, model, text); } catch (e) { return false; }
  },
  async getNavmarks(docKey) {
    const r = R(); if (!r || !r.getNavmarks || !docKey) return [];
    try { return (await r.getNavmarks(docKey)) || []; } catch (e) { return []; }
  },
  async saveNavmarks(docKey, pages) {
    const r = R(); if (!r || !r.saveNavmarks || !docKey) return false;
    try { return await r.saveNavmarks(docKey, pages); } catch (e) { return false; }
  },
  async testLlm(cfg) {
    const api = A();
    if (!api || !api.testLlm) return { ok: false, error: "未连接本地引擎，无法测试连接" };
    try { return await api.testLlm(cfg); } catch (e) { return { ok: false, error: "测试失败" }; }
  },
  async secretHas(key) {
    const api = A();
    if (!api || !api.secretHas || !key) return false;
    try { return !!(await api.secretHas(key)); } catch { return false; }
  },
  async saveSettings(s) {
    const api = A(); if (!api) return null;
    const clean = { ...(s || {}) };
    delete clean.emailConfigured;
    delete clean.emailFromEnv;
    return api.saveSettings(clean);
  },
  async resetLocalData() { const api = A(); if (!api || !api.resetLocalData) return { ok: false, error: "no_backend" }; return api.resetLocalData(); },
  async getUserDataPath() { const api = A(); if (!api || !api.getUserDataPath) return null; try { return await api.getUserDataPath(); } catch { return null; } },
  async setSecret(k, v) { const api = A(); if (!api) return null; return api.setSecret(k, v); },
  async sourcesStatus() {
    const api = A(); if (!api || !api.sourcesStatus) return {};
    try { return (await api.sourcesStatus()) || {}; } catch { return {}; }
  },
  async sourcesRegistry() {
    const api = A(); if (!api || !api.sourcesRegistry) return null;
    try { return await api.sourcesRegistry(); } catch { return null; }
  },
  async testSource(name, cand) {
    const api = A(); if (!api || !api.testSource) return { ok: false, error: "no_backend" };
    try { return await api.testSource(name, cand); } catch (e) { return { ok: false, error: "test_failed" }; }
  },
  openExternal(url) {
    const api = A(); if (api && api.openExternal) { try { api.openExternal(url); return true; } catch { /* noop */ } }
    if (typeof url === "string") window.open(url, "_blank");
    return false;
  },
  onOpenLocalPdf(cb) {
    const api = A(); if (!api || !api.onOpenLocalPdf) return;
    try { api.onOpenLocalPdf(cb); } catch (e) { /* noop */ }
  },
  // 后台/启动设置 → 主进程（关窗最小化到托盘 + 开机自启）。无后端 no-op。
  async setBackground(minimizeToTray, openAtLogin) {
    const api = A(); if (!api || !api.setBackground) return { ok: false, error: "no_backend" };
    try { return await api.setBackground({ minimizeToTray, openAtLogin }); } catch (e) { return { ok: false, error: "set_failed" }; }
  },
  // 渐进式检索：转发到 preload；返回停止函数。无后端/旧版预载返回 null → FindFetch 回落一次性 searchOnline。
  searchOnlineStream(raw, filters, reqId, cb) {
    const api = A();
    if (api && api.searchOnlineStream) {
      try { return api.searchOnlineStream(raw, filters, reqId, cb) || (() => {}); } catch (e) { return null; }
    }
    return null;
  },
  async exportCitation(items, fmt) {
    const api = A();
    if (api && api.exportCitation) {
      try { return await api.exportCitation(items, fmt); } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
    }
    const list = Array.isArray(items) ? items : [items];
    const text = fmt === "ris"
      ? list.map((p) => `TY  - JOUR\r\nTI  - ${p.title || ""}\r\nDO  - ${p.doi || ""}\r\nER  - \r\n`).join("")
      : list.map((p) => `@article{${p.id || "ref"}, title={${p.title || ""}}, doi={${p.doi || ""}}}`).join("\n");
    try {
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `export.${fmt === "ris" ? "ris" : "bib"}`;
      a.click();
      URL.revokeObjectURL(a.href);
      return { ok: true, mock: true };
    } catch (e) { return { ok: false, reason: "export_failed" }; }
  },
};
