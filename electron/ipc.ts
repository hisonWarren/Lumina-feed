// lumina-feed · IPC（干净基线：检索 · 总结 · OA · 设置）+ reader_engine（OA 取/存/读回 · 阅读器接地 AI）
import { ipcMain, app, Notification } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../src/core/store/index.ts";
import type { SecretStore } from "../src/core/secrets/keyvault.ts";
import { rawToSpec } from "../src/core/querySpec.ts";
import { aggregateSearch, aggregateSearchStream } from "../src/core/aggregate.ts";
import { llmFromConfig, listModels } from "../src/core/summarize/llm-client.ts";
import { makeOaFullTextProvider, fetchPaperPdf } from "../src/core/oa/provider.ts";
import { resolvePdfCandidates } from "../src/core/oa/oa-resolver.ts";
import { fetchPdf } from "../src/core/oa/pdf-fetch.ts";
import { sqliteSummaryCache } from "../src/core/summarize/summaries.repo.ts";
import { summarizeGrounded } from "../src/core/trust/index.ts";
import { analyzeReader, analyzeFigure, analyzeCorpus, KIND_REGISTRY, type AnalysisEnvelope } from "../src/core/reader/reader-plus.ts";
import { saveGrounding } from "../src/core/trust/audit.ts";
import { summarizeReader, askReader, translateText, type ReaderPage } from "../src/core/reader/reader-ai.ts";
import { loadAppSettings, saveAppSettings } from "./settings.ts";
import type { SummarizeOptions } from "../src/core/summarize/types.ts";
import { DEFAULT_SUMMARIZE } from "../src/core/summarize/types.ts";

export interface IpcDeps {
  store: Store;
  secrets: SecretStore;
}

/** 统一异常 → 拒绝信封（ISSUE-001/004）：分析类 IPC 失败时不返回 null，而给结构化拒绝原因，UI 可显示。 */
function analysisError(kind: string, e: unknown, opts: { vision?: boolean; sourceBasis?: string } = {}): AnalysisEnvelope {
  const msg = (e && (e as { message?: unknown }).message) ? String((e as { message?: unknown }).message) : "未知错误";
  const spec = (KIND_REGISTRY as Record<string, { lane?: "evidence" | "inference"; title?: string }>)[kind];
  const lane: "evidence" | "inference" = (spec && spec.lane) || "inference";
  const title: string = (spec && spec.title) || "分析";
  const noLlm = /未配置 LLM/.test(msg);
  let reason: string;
  if (noLlm) reason = "尚未配置大模型。请在『设置 → 大模型』选择 provider 并填入密钥后重试。";
  else if (opts.vision) reason = "图表分析调用失败（" + msg + "）。常见原因：当前模型不支持视觉输入。请改用本地 Ollama 视觉模型（如 llava / qwen2-vl），或 OpenAI / Anthropic 的视觉模型——纯文本模型（如 deepseek-v4-flash）无法读图。";
  else reason = "分析失败（" + msg + "）。请重试；若反复失败，请检查模型、密钥或网络。";
  return { kind, lane, groundability: "L2", sourceBasis: (opts.sourceBasis as AnalysisEnvelope["sourceBasis"]) || "fulltext", model: "(none)", title, refused: { reason }, claims: [] } as AnalysisEnvelope;
}

export function registerIpc(deps: IpcDeps): void {
  const { store, secrets } = deps;

  const pdfDir = (): string => { const d = path.join(app.getPath("userData"), "pdfs"); fs.mkdirSync(d, { recursive: true }); return d; };
  const pdfPath = (id: string): string => path.join(pdfDir(), encodeURIComponent(id) + ".pdf");

  ipcMain.handle("search:online", async (_e, raw: string, filters) => {
    const spec = rawToSpec(raw, filters);
    const agg = await aggregateSearch(spec, { limit: 30 });
    store.papers.upsertMany(agg.papers);
    return { perSource: agg.perSource, count: agg.papers.length, papers: agg.papers };
  });

  // 渐进式检索：每个开放源返回即把当前累积快照推给渲染层（search:stream 事件），慢源不拖累首屏。
  ipcMain.handle("search:online-stream", async (e, raw: string, filters, reqId) => {
    const spec = rawToSpec(raw, filters);
    const send = (payload: unknown) => { try { e.sender.send("search:stream", payload); } catch { /* 渲染层已关则忽略 */ } };
    const agg = await aggregateSearchStream(spec, { limit: 30 }, (source, snapshot, perSource) => {
      send({ reqId, source, papers: snapshot, perSource, done: false });
    });
    store.papers.upsertMany(agg.papers);
    send({ reqId, papers: agg.papers, perSource: agg.perSource, done: true });
    return { ok: true };
  });

  ipcMain.handle("summarize:paper", async (_e, paperId: string, opts: SummarizeOptions) => {
    const paper = store.papers.getById(paperId);
    if (!paper) throw new Error("文献不存在");
    const settings = await loadAppSettings(store);
    if (!settings.llm) throw new Error("未配置 LLM");
    const llm = await llmFromConfig(settings.llm, () => secrets.get(`${settings.llm!.provider}_key`));
    const fullText = makeOaFullTextProvider({ email: settings.contactEmail, includeAltSources: true });
    const cache = sqliteSummaryCache(store.db);
    const res = await summarizeGrounded(paper, opts, { llm, fullText, cache, ground: {} });
    if (res) saveGrounding(store.db, paper.id, res.model, res.sourceBasis, res.grounded);
    return res;
  });

  ipcMain.handle("oa:resolve", async (_e, paperId: string) => {
    const paper = store.papers.getById(paperId);
    if (!paper) return null;
    const settings = await loadAppSettings(store);
    const cands = await resolvePdfCandidates(paper, { email: settings.contactEmail, includeAltSources: true });
    const first = cands[0];
    if (first?.kind === "url") return first.url;
    return paper.oaUrl ?? null;
  });

  // 统一候选链取文：OA → LibGen → Anna → Sci-Hub，成功则落盘。
  ipcMain.handle("oa:fetchPaper", async (_e, paperId: string) => {
    const paper = store.papers.getById(paperId);
    if (!paper) return { ok: false, reason: "not_found" };
    const settings = await loadAppSettings(store);
    try {
      const res = await fetchPaperPdf(paper, { email: settings.contactEmail, includeAltSources: true });
      if (!res.ok) return res;
      try { fs.writeFileSync(pdfPath(paperId), Buffer.from(res.bytes)); } catch { /* 落盘失败不阻断 */ }
      return res;
    } catch (e: unknown) {
      const msg = (e && (e as { message?: unknown }).message) ? String((e as { message?: unknown }).message) : "取文失败";
      console.error("oa:fetchPaper 失败", paperId, msg);
      return { ok: false, reason: msg };
    }
  });

  ipcMain.handle("settings:get", () => loadAppSettings(store));
  ipcMain.handle("settings:save", async (_e, s) => { await saveAppSettings(store, s); return true; });
  ipcMain.handle("secrets:set", (_e, key: string, value: string) => secrets.set(key, value));
  // 测试连接：用当前(表单或已存)配置做一次极小补全，验证密钥/模型/网络是否通。不持久化、不回显密钥（红线3）。
  ipcMain.handle("llm:test", async (_e, cfg: { provider?: string; model?: string; baseUrl?: string; apiKey?: string }) => {
    try {
      const settings = await loadAppSettings(store);
      const provider = (cfg && cfg.provider) || (settings.llm && settings.llm.provider) || "";
      const model = (cfg && cfg.model) || (settings.llm && settings.llm.model) || "";
      if (!provider || !model) return { ok: false, error: "请先选择提供方与模型" };
      const llmCfg: any = { provider, model };
      if (cfg && cfg.baseUrl) llmCfg.baseUrl = cfg.baseUrl;
      const getKey = async () => (cfg && cfg.apiKey) ? cfg.apiKey : await secrets.get(`${provider}_key`);
      const llm = await llmFromConfig(llmCfg, getKey);
      const t0 = Date.now();
      const out = await llm.complete([{ role: "user", content: "回复两个字：你好" }], { maxTokens: 8, temperature: 0 });
      const ms = Date.now() - t0;
      if (!out || !String(out).trim()) return { ok: false, error: "已连接，但模型未返回内容（请检查模型名）" };
      return { ok: true, model, ms };
    } catch (e: any) { return { ok: false, error: (e && e.message) ? String(e.message) : "连接失败" }; }
  });

  // 列出供应商可用模型（动态拉取；失败时 UI 回落内置清单）。复用 llm:test 的 getKey（cfg.apiKey 优先，否则钥匙串）。
  ipcMain.handle("llm:listModels", async (_e, cfg: { provider?: string; model?: string; baseUrl?: string; apiKey?: string }) => {
    try {
      const settings = await loadAppSettings(store);
      const provider = (cfg && cfg.provider) || (settings.llm && settings.llm.provider) || "";
      if (!provider) return { ok: false, error: "请先选择提供方" };
      const llmCfg: any = { provider, model: (cfg && cfg.model) || "" };
      if (cfg && cfg.baseUrl) llmCfg.baseUrl = cfg.baseUrl;
      const getKey = async () => (cfg && cfg.apiKey) ? cfg.apiKey : await secrets.get(`${provider}_key`);
      return await listModels(llmCfg, getKey);
    } catch (e: any) { return { ok: false, error: (e && e.message) ? String(e.message) : "拉取失败" }; }
  });

  // ── reader_engine：全文取文 / 落盘 / 读回 ──
  ipcMain.handle("oa:fetchPdf", async (_e, url: string, paperId?: string) => {
    try {
      const bytes = await fetchPdf(url, { allowAltSources: true });
      if (paperId) { try { fs.writeFileSync(pdfPath(paperId), Buffer.from(bytes)); } catch { /* 落盘失败不阻断渲染 */ } }
      return { ok: true, bytes };
    } catch (e: unknown) {
      const msg = (e && (e as { message?: unknown }).message) ? String((e as { message?: unknown }).message) : "取文失败";
      console.error("oa:fetchPdf 失败", url, msg);
      return { ok: false, reason: msg };
    }
  });
  // 读回已存 PDF 字节（供「已下载全文」开读）；不存在返回 null。
  ipcMain.handle("oa:readPdf", async (_e, paperId: string) => {
    try { const p = pdfPath(paperId); if (!fs.existsSync(p)) return null; return new Uint8Array(fs.readFileSync(p)); } catch { return null; }
  });
  // 列出已下载全文（关联 store 取标题）。
  ipcMain.handle("oa:listPdfs", () => {
    try {
      return fs.readdirSync(pdfDir()).filter((f) => f.endsWith(".pdf")).map((f) => {
        const id = decodeURIComponent(f.slice(0, -4));
        const paper = store.papers.getById(id);
        return { paperId: id, title: paper ? paper.title : undefined, oaUrl: paper ? paper.oaUrl : undefined };
      });
    } catch { return []; }
  });

  // ── reader_engine：阅读器接地 AI（对逐页文本总结/问答，带页码引用；只单篇）──
  const makeLlm = async () => {
    const settings = await loadAppSettings(store);
    if (!settings.llm) throw new Error("未配置 LLM");
    return llmFromConfig(settings.llm, () => secrets.get(`${settings.llm!.provider}_key`));
  };
  ipcMain.handle("reader:summarize", async (_e, payload: { pages?: ReaderPage[] }) => {
    const llm = await makeLlm();
    return summarizeReader((payload && payload.pages) || [], llm);
  });
  ipcMain.handle("reader:ask", async (_e, payload: { pages?: ReaderPage[]; question?: string }) => {
    const llm = await makeLlm();
    return askReader((payload && payload.pages) || [], (payload && payload.question) || "", llm);
  });
  ipcMain.handle("reader:translate", async (_e, payload: { text?: string }) => {
    const llm = await makeLlm();
    return { text: await translateText((payload && payload.text) || "", llm), model: llm.model };
  });

  // ── reader_plus：统一分析派发（信封；lane 由引擎注册表决定）+ 分析缓存（本地优先，红线7）──
  ipcMain.handle("reader:analyze", async (_e, payload: { kind?: string; pages?: ReaderPage[]; text?: string; page?: number }) => {
    const kind = (payload && payload.kind) || "outline";
    try { const llm = await makeLlm(); return await analyzeReader(kind, (payload && payload.pages) || [], { llm, text: payload && payload.text, page: payload && payload.page }); }
    catch (e) { console.error("reader:analyze 失败", e); return analysisError(kind, e); }
  });
  // ── reader_plus·写作 swipe file（带出处；本地优先，红线7）──
  const ensureSwipe = () => store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
  const swipeRead = (): any[] => { try { ensureSwipe(); const r: any = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("swipe:all"); return r && r.payload ? JSON.parse(r.payload) : []; } catch { return []; } };
  const swipeWrite = (list: any[]) => { try { ensureSwipe(); store.db.prepare("INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at").run("swipe:all", JSON.stringify(list), new Date().toISOString()); return true; } catch { return false; } };
  ipcMain.handle("swipe:get", () => swipeRead());
  ipcMain.handle("swipe:save", (_e, item: any) => { if (!item) return false; const list = swipeRead(); list.unshift({ ...item, id: item.id || ("sw" + Date.now()) }); return swipeWrite(list.slice(0, 500)); });
  ipcMain.handle("swipe:remove", (_e, id: string) => swipeWrite(swipeRead().filter((x: any) => x.id !== id)));
  // ── reader_plus·练判断留痕（ADR-I4：揭示前先记录用户判断，不自动给答案）──
  ipcMain.handle("reader:practiceSave", (_e, paperId: string, kind: string, userText: string) => {
    try { if (!paperId || !kind) return false; ensureSwipe(); store.db.prepare("INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at").run("practice:" + paperId + ":" + kind, JSON.stringify({ text: userText || "", at: new Date().toISOString() }), new Date().toISOString()); return true; } catch { return false; }
  });
  // ── reader_plus·读图（ADR-I5 隐私闸）：本地视觉模型(ollama)直放；云端须 settings.llm.visionConsent，否则返回拒绝信封引导去设置（红线7）。
  ipcMain.handle("reader:figure", async (_e, payload: { dataUrl?: string; caption?: string }) => {
    try {
      if (!payload || !payload.dataUrl) return analysisError("figure", new Error("缺少图像数据"), { vision: true, sourceBasis: "fulltext+vision" });
      const settings = await loadAppSettings(store);
      const provider = (settings.llm && settings.llm.provider) || "";
      const isLocal = provider === "ollama";
      const consent = !!(settings.llm && (settings.llm as any).visionConsent);
      if (!isLocal && !consent) {
        return { kind: "figure", lane: "inference", groundability: "L2", sourceBasis: "external", model: "(none)", title: "图表分析",
          refused: { reason: "图表分析需把图像发送到云端视觉模型（当前：" + (provider || "未配置") + "）。请在『设置 → 大模型』开启『允许云端读图』，或改用本地视觉模型（Ollama）。图像在授权前不会离开本机。" }, claims: [] } as AnalysisEnvelope;
      }
      const llm = await makeLlm();
      return await analyzeFigure(payload.dataUrl, payload.caption || "", llm);
    } catch (e) { console.error("reader:figure 失败", e); return analysisError("figure", e, { vision: true, sourceBasis: "fulltext+vision" }); }
  });
  // ── reader_plus·语料层（ADR-I6）：仅就选中工作集文献跨篇归纳（限工作集、非整库级问答）。后端聚合各篇 标题+缓存总结+摘要，篇数上限 8（控成本/上下文）。
  ipcMain.handle("reader:corpus", async (_e, payload: { kind?: string; paperIds?: string[] }) => {
    const kind = (payload && payload.kind) || "corpus_framing";
    try {
      const ids = ((payload && payload.paperIds) || []).slice(0, 8);
      if (ids.length < 2) return { kind, lane: "inference", groundability: "L2", sourceBasis: "corpus", model: "(none)", title: "跨篇分析", refused: { reason: "跨篇分析至少需要 2 篇文献。" }, claims: [] } as AnalysisEnvelope;
      const papers: Array<{ id: string; title: string; abstract?: string; summary?: string | null }> = [];
      for (const id of ids) {
        const p: any = store.papers.getById(id);
        if (!p) continue;
        let summary: string | null = null;
        try { const r: any = store.db.prepare("SELECT text FROM summaries WHERE paper_id=? ORDER BY created_at DESC LIMIT 1").get(id); summary = r && r.text ? r.text : null; } catch { /* none */ }
        papers.push({ id, title: p.title || "", abstract: p.abstract, summary });
      }
      const llm = await makeLlm();
      return await analyzeCorpus(kind, papers as any, llm);
    } catch (e) { console.error("reader:corpus 失败", e); return analysisError(kind, e, { sourceBasis: "corpus" }); }
  });
  const ensureReaderAnalysis = () => store.db.exec("CREATE TABLE IF NOT EXISTS reader_analysis(paper_id TEXT, kind TEXT, lane TEXT, payload TEXT, model TEXT, created_at TEXT, PRIMARY KEY(paper_id,kind));");
  ipcMain.handle("reader:analysisGet", (_e, paperId: string, kind: string) => {
    try { ensureReaderAnalysis(); const r: any = store.db.prepare("SELECT payload FROM reader_analysis WHERE paper_id=? AND kind=?").get(paperId, kind); return r && r.payload ? JSON.parse(r.payload) : null; } catch { return null; }
  });
  ipcMain.handle("reader:analysisSave", (_e, paperId: string, env: AnalysisEnvelope) => {
    try {
      if (!paperId || !env || !env.kind) return false;
      ensureReaderAnalysis();
      store.db.prepare("INSERT INTO reader_analysis(paper_id,kind,lane,payload,model,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(paper_id,kind) DO UPDATE SET payload=excluded.payload, lane=excluded.lane, model=excluded.model, created_at=excluded.created_at")
        .run(paperId, env.kind, env.lane, JSON.stringify(env), env.model, new Date().toISOString());
      return true;
    } catch { return false; }
  });

  // ── reader_p3：批注侧车（SQLite，以 docKey 为键，本地优先，红线7）──
  const ensureAnno = () => store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
  ipcMain.handle("annotations:get", (_e, docKey: string) => {
    try { ensureAnno(); const r: any = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("anno:" + docKey); return r && r.payload ? JSON.parse(r.payload) : []; }
    catch { return []; }
  });
  ipcMain.handle("annotations:save", (_e, docKey: string, list: unknown) => {
    try {
      ensureAnno();
      store.db.prepare("INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at")
        .run("anno:" + docKey, JSON.stringify(list || []), new Date().toISOString());
      return true;
    } catch { return false; }
  });

  // 翻译持久化（派生缓存，非权威）：sources_cache 键 translate:<docKey> → { [page]: {text, model, at} }。划词译走会话内存不落库。
  ipcMain.handle("translations:get", (_e, docKey: string) => {
    try { ensureAnno(); const r: any = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("translate:" + docKey); return r && r.payload ? JSON.parse(r.payload) : {}; }
    catch { return {}; }
  });
  ipcMain.handle("translations:save", (_e, docKey: string, page: number, model: string, text: string) => {
    try {
      ensureAnno();
      const row: any = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("translate:" + docKey);
      const map = row && row.payload ? JSON.parse(row.payload) : {};
      map[String(page)] = { text: String(text || ""), model: String(model || ""), at: new Date().toISOString() };
      store.db.prepare("INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at")
        .run("translate:" + docKey, JSON.stringify(map), new Date().toISOString());
      return true;
    } catch { return false; }
  });

  // 页面书签持久化（仅导航，非批注）：sources_cache 键 navmark:<docKey> → number[]（页码升序去重，上限 200）。
  ipcMain.handle("navmarks:get", (_e, docKey: string) => {
    try { ensureAnno(); const r: any = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("navmark:" + docKey); const a = r && r.payload ? JSON.parse(r.payload) : []; return Array.isArray(a) ? a : []; }
    catch { return []; }
  });
  ipcMain.handle("navmarks:save", (_e, docKey: string, pages: number[]) => {
    try {
      ensureAnno();
      const clean = Array.from(new Set((Array.isArray(pages) ? pages : []).map((n) => parseInt(String(n), 10)).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b).slice(0, 200);
      store.db.prepare("INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at")
        .run("navmark:" + docKey, JSON.stringify(clean), new Date().toISOString());
      return true;
    } catch { return false; }
  });

  // ── subscriptions：订阅 CRUD（SQLite 持久化）+ runNow 真检索（关键词/期刊）+ 成本闸 ──
  const ensureSubs = () => store.db.exec("CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);");
  ipcMain.handle("subs:list", () => {
    try { ensureSubs(); const rows = store.db.prepare("SELECT payload FROM subscriptions ORDER BY updated_at DESC").all() as Array<{ payload: string }>; return rows.map((r) => JSON.parse(r.payload)); }
    catch { return []; }
  });
  ipcMain.handle("subs:get", (_e, id: string) => {
    try { ensureSubs(); const r = store.db.prepare("SELECT payload FROM subscriptions WHERE id=?").get(id) as { payload?: string } | undefined; return r && r.payload ? JSON.parse(r.payload) : null; }
    catch { return null; }
  });
  ipcMain.handle("subs:save", (_e, sub: any) => {
    try {
      ensureSubs();
      const sv = sub && sub.id ? sub : { ...sub, id: "s" + Date.now() };
      store.db.prepare("INSERT INTO subscriptions(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
        .run(sv.id, JSON.stringify(sv), new Date().toISOString());
      return sv;
    } catch { return sub; }
  });
  ipcMain.handle("subs:remove", (_e, id: string) => {
    try { ensureSubs(); store.db.prepare("DELETE FROM subscriptions WHERE id=?").run(id); return true; } catch { return false; }
  });
  // 立即运行：构造检索式（关键词走 rawToSpec；期刊走 journal 字段，PubMed [Journal] 接受 ISSN/刊名，限非预印本源）→ 真检索 → 落库；
  // 成本闸 autoSummarize 限制自动总结范围（off/abstract/topN）。今日命中以引擎 Paper 返回，渲染层经 toCardModel 映射。
  ipcMain.handle("subs:runNow", async (_e, sub: any) => runSubscriptionNow(sub, store, secrets));

  // ── library（工作集持久化）+ lists（单层清单持久化）+ 富集（有全文/有总结/总结正文）──
  // 注：批注按"文件名:字节数"为 docKey（见 Reader），与 paperId 不一一对应，故"有批注/批注数"留后续（需 paperId↔docKey 映射）。
  const ensureLib = () => {
    store.db.exec("CREATE TABLE IF NOT EXISTS library(paper_id TEXT PRIMARY KEY, provenance TEXT, added_at TEXT);");
    store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
  };
  const summaryOf = (id: string): string | null => {
    try { const r = store.db.prepare("SELECT text FROM summaries WHERE paper_id=? ORDER BY created_at DESC LIMIT 1").get(id) as { text?: string } | undefined; return r && r.text ? r.text : null; } catch { return null; }
  };
  ipcMain.handle("library:list", () => {
    try {
      ensureLib();
      const rows = store.db.prepare("SELECT paper_id, provenance, added_at FROM library ORDER BY added_at DESC").all() as Array<{ paper_id: string; provenance: string; added_at: string }>;
      const out: Array<Record<string, unknown>> = [];
      for (const r of rows) {
        const paper = store.papers.getById(r.paper_id);
        if (!paper) continue;
        const st = summaryOf(r.paper_id);
        let hasFull = false; try { hasFull = fs.existsSync(pdfPath(r.paper_id)); } catch { /* ignore */ }
        let annoCount = 0, annoText = "";
        try {
          const a = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("anno:paper:" + r.paper_id) as { payload?: string } | undefined;
          if (a && a.payload) { const al = JSON.parse(a.payload); if (Array.isArray(al)) { annoCount = al.length; annoText = al.map((x: any) => `${x.anchoredText || ""} ${x.note || ""}`).join(" ").trim(); } }
        } catch { /* ignore */ }
        out.push({ paper, provenance: r.provenance, addedAt: r.added_at, hasFull, hasSummary: !!st, summaryText: st || "", annoCount, annoText });
      }
      return out;
    } catch { return []; }
  });
  ipcMain.handle("library:add", (_e, paperId: string, provenance?: string) => {
    try { ensureLib(); store.db.prepare("INSERT INTO library(paper_id,provenance,added_at) VALUES(?,?,?) ON CONFLICT(paper_id) DO UPDATE SET provenance=excluded.provenance").run(paperId, provenance || "find_fetch", new Date().toISOString()); return true; } catch { return false; }
  });
  ipcMain.handle("library:remove", (_e, paperId: string) => {
    try { ensureLib(); store.db.prepare("DELETE FROM library WHERE paper_id=?").run(paperId); return true; } catch { return false; }
  });
  ipcMain.handle("lists:get", () => {
    try { ensureLib(); const r = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("lists:all") as { payload?: string } | undefined; return r && r.payload ? JSON.parse(r.payload) : []; } catch { return []; }
  });
  ipcMain.handle("lists:save", (_e, lists: unknown) => {
    try { ensureLib(); store.db.prepare("INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at").run("lists:all", JSON.stringify(lists || []), new Date().toISOString()); return true; } catch { return false; }
  });

  // ── PDF 正文索引（FTS5）+ 库内正文检索 ──
  // 正文经渲染层既有 pdfjs 抽取后送来（reader 打开/总结时），避免主进程再跑 pdfjs。FTS5 独立表，不动 papers_fts。
  // CJK 友好的 FTS 预处理：对连续 CJK 段生成重叠 bigram（默认 unicode61 把整段当一个 token，2 字词搜不到）；英文/数字原样保留。索引与查询用同一函数，保持一致。
  const ftsPrep = (text: string): string => {
    const chars = Array.from(String(text || ""));
    const isCJK = (ch: string): boolean => { const c = ch.codePointAt(0) || 0; return (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x2ffff); };
    let out = ""; let i = 0;
    while (i < chars.length) {
      if (isCJK(chars[i])) {
        const run: string[] = [];
        while (i < chars.length && isCJK(chars[i])) { run.push(chars[i]); i++; }
        if (run.length === 1) out += " " + run[0] + " ";
        else for (let k = 0; k + 1 < run.length; k++) out += " " + run[k] + run[k + 1] + " ";
      } else { out += chars[i]; i++; }
    }
    return out;
  };
  const ensureFts = () => store.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fulltext_fts USING fts5(paper_id UNINDEXED, body);");
  ipcMain.handle("fulltext:save", (_e, paperId: string, text: string) => {
    try {
      if (!paperId || !text) return false;
      ensureFts();
      store.db.prepare("DELETE FROM fulltext_fts WHERE paper_id=?").run(paperId);
      store.db.prepare("INSERT INTO fulltext_fts(paper_id, body) VALUES(?,?)").run(paperId, ftsPrep(String(text).slice(0, 2000000))); // CJK→bigram 后入库；上限 ~2MB 原文
      return true;
    } catch { return false; }
  });
  // 库内正文检索：FTS5 MATCH（短语，转义引号）∩ 工作集 → 返回命中 paperId 列表（渲染层与客户端元数据/总结/批注命中合并）。
  ipcMain.handle("search:local", (_e, query: string) => {
    try {
      const q = String(query || "").trim();
      if (!q) return [];
      ensureFts(); ensureLib();
      const DQ = String.fromCharCode(34); // 双引号字面，避免源码里裸双引号
      const prepped = ftsPrep(q).split(" ").filter(Boolean).join(" "); // CJK→bigram，与索引一致
      if (!prepped) return [];
      const phrase = DQ + prepped.split(DQ).join(DQ + DQ) + DQ; // FTS5 短语：转义内部双引号
      const rows = store.db.prepare("SELECT f.paper_id AS id FROM fulltext_fts f JOIN library l ON l.paper_id = f.paper_id WHERE f.body MATCH ?").all(phrase) as Array<{ id: string }>;
      return rows.map((r) => r.id);
    } catch { return []; }
  });
}

// ── 订阅运行核心（手动 runNow 与调度器共用）+ 调度器 ──
function ensureSubsTable(db: Store["db"]): void {
  db.exec("CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);");
}
async function runSubscriptionNow(sub: any, store: Store, secrets: SecretStore): Promise<{ ok: boolean; hits: any[] }> {
  try {
    const kind = (sub && sub.kind) || "keyword";
    let spec: any;
    if (kind === "journal") {
      const j = (sub && sub.journal) || {};
      const value = (j.issn && String(j.issn).trim()) || (j.name && String(j.name).trim()) || ((sub && sub.q) || "").trim();
      if (!value) return { ok: false, hits: [] };
      spec = { groups: [{ op: "AND", terms: [{ field: "journal", value }] }], filters: { sources: ["pubmed", "europepmc", "crossref", "openalex"] } };
    } else {
      spec = rawToSpec((sub && sub.q) || "", {});
      if (!spec.groups.length) return { ok: false, hits: [] };
    }
    const agg = await aggregateSearch(spec, { limit: 30 });
    store.papers.upsertMany(agg.papers);
    // seenIds 跨次去重：只把"未见过的"作为今日新增
    const seen = new Set<string>(Array.isArray(sub && sub.seenIds) ? sub.seenIds : []);
    const fresh = agg.papers.filter((pp: any) => !seen.has(pp.id));
    const mode = (sub && sub.autoSummarize) || "off";
    if (mode !== "off") {
      try {
        const settings = await loadAppSettings(store);
        if (settings.llm) {
          const llm = await llmFromConfig(settings.llm, () => secrets.get(`${settings.llm!.provider}_key`));
          const fullText = makeOaFullTextProvider({ email: settings.contactEmail, includeAltSources: true });
          const cache = sqliteSummaryCache(store.db);
          const opts: SummarizeOptions = mode === "abstract"
            ? { ...DEFAULT_SUMMARIZE, source: "abstract_only", fetchPdf: "no", scope: "digest_hits" }
            : { ...DEFAULT_SUMMARIZE, scope: "digest_hits" };
          const targets = mode === "topN" ? fresh.slice(0, 3) : fresh; // 成本闸只对新增
          for (const pp of targets) {
            try { const r = await summarizeGrounded(pp, opts, { llm, fullText, cache, ground: {} }); if (r) saveGrounding(store.db, pp.id, r.model, r.sourceBasis, r.grounded); }
            catch { /* 单条总结失败不阻断 */ }
          }
        }
      } catch { /* 成本闸总结失败不阻断 */ }
    }
    try {
      ensureSubsTable(store.db);
      const newSeen = [...seen, ...fresh.map((pp: any) => pp.id)].slice(-500); // 上限 500
      const next = { ...sub, today: fresh.slice(0, 50), lastRunAt: new Date().toISOString(), seenIds: newSeen };
      store.db.prepare("INSERT INTO subscriptions(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
        .run(next.id, JSON.stringify(next), next.lastRunAt as string);
    } catch { /* 持久化失败不阻断返回 */ }
    return { ok: true, hits: fresh };
  } catch { return { ok: false, hits: [] }; }
}
function isSubDue(sub: any, now: Date): boolean {
  if (!sub || sub.enabled === false) return false;
  const last = sub.lastRunAt ? new Date(sub.lastRunAt) : null;
  const ms = last ? (now.getTime() - last.getTime()) : Infinity;
  if (sub.freq === "hourly") return ms >= 55 * 60 * 1000;
  if (sub.freq === "weekly") return ms >= 7 * 24 * 3600 * 1000;
  const parts = String(sub.time || "08:00").split(":");
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  const sched = new Date(now); sched.setHours(isNaN(h) ? 8 : h, isNaN(m) ? 0 : m, 0, 0);
  const ranToday = !!last && last.toDateString() === now.toDateString();
  return !ranToday && now.getTime() >= sched.getTime();
}
/** 订阅调度器：启动后 ~30s 跑一次，此后每 ~10 分钟检查到期订阅并真检索；有命中则系统通知。成本闸在 runSubscriptionNow 内生效。 */
export function startSubsScheduler(store: Store, secrets: SecretStore): void {
  const tick = async () => {
    try {
      ensureSubsTable(store.db);
      const rows = store.db.prepare("SELECT payload FROM subscriptions").all() as Array<{ payload: string }>;
      const now = new Date();
      for (const row of rows) {
        let sub: any; try { sub = JSON.parse(row.payload); } catch { continue; }
        if (!isSubDue(sub, now)) continue;
        const res = await runSubscriptionNow(sub, store, secrets);
        if (res.ok && res.hits.length) {
          try { if (Notification.isSupported()) new Notification({ title: `Lumina · ${sub.name || sub.q || "订阅"}`, body: `今日新增 ${res.hits.length} 条` }).show(); } catch { /* 通知失败忽略 */ }
        }
      }
    } catch { /* 调度循环不抛 */ }
  };
  setTimeout(() => { void tick(); }, 30 * 1000);
  setInterval(() => { void tick(); }, 10 * 60 * 1000);
}
