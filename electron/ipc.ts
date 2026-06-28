// lumina-feed · IPC（干净基线：检索 · 总结 · OA · 设置）+ reader_engine（OA 取/存/读回 · 阅读器接地 AI）
import { ipcMain, app, Notification, BrowserWindow, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../src/core/store/index.ts";
import type { SecretStore } from "../src/core/secrets/keyvault.ts";
import { rawToSpec } from "../src/core/querySpec.ts";
import { aggregateSearch, aggregateSearchStream, searchSingleSource } from "../src/core/aggregate.ts";
import { runLocateKeywordStream } from "../src/core/locate/locate-stream.ts";
import { titleFastLane } from "../src/core/locate/title-fast-lane.ts";
import { isTitleLikeQuery, titleQueryText } from "../src/core/locate/title-like.ts";
import { pickPrimaryHit } from "../src/core/locate/primary-hit.ts";
import { resolveIdentifierInput, classifyInput } from "../src/core/locate/resolve-identifier.ts";
import { shouldPrefetchOnLocate } from "../src/core/locate/prefetch-eligibility.ts";
import { listSourceRegistry } from "../src/core/sources/index.ts";
import { llmFromConfig, listModels } from "../src/core/summarize/llm-client.ts";
import { makeOaFullTextProvider, fetchPaperPdf } from "../src/core/oa/provider.ts";
import { attemptSignal } from "../src/core/oa/timeout.ts";
import { probeAllMirrors } from "../src/core/oa/mirror-health.ts";
import { resolvePdfCandidates } from "../src/core/oa/oa-resolver.ts";
import { fetchPdf } from "../src/core/oa/pdf-fetch.ts";
import { sqliteSummaryCache } from "../src/core/summarize/summaries.repo.ts";
import { summarizeGrounded } from "../src/core/trust/index.ts";
import { analyzeReader, analyzeFigure, analyzeCorpus, KIND_REGISTRY, type AnalysisEnvelope } from "../src/core/reader/reader-plus.ts";
import { saveGrounding } from "../src/core/trust/audit.ts";
import { summarizeReader, askReader, translateText, type ReaderPage } from "../src/core/reader/reader-ai.ts";
import {
  clearReadingHistory,
  ensureReadingHistoryTable,
  isSafeLocalPdfPath,
  listContinueReading,
  normalizeLocalPath,
  openedAtForPaper,
  recordReadingOpen,
  removeReadingHistory,
  touchReadingPage,
  type ReadingHistoryRow,
} from "../src/core/reader/reading-history.ts";
import { loadAppSettings, saveAppSettings, loadAppSettingsView } from "./settings.ts";
import type { SummarizeOptions } from "../src/core/summarize/types.ts";
import { DEFAULT_SUMMARIZE } from "../src/core/summarize/types.ts";
import { setPoliteIdentity } from "../src/core/sources/adapter.ts";
import type { SearchOpts } from "../src/core/sources/adapter.ts";
import { shouldSignalMissingEmail } from "../src/core/oa/oa-extended.ts";
import type { Paper } from "../src/core/model.ts";
import {
  applyDigestSearchOpts, buildDigestSpec, normalizeSubscription, freshHits, type DigestRunMeta,
} from "../src/core/subs/digest-search.ts";
import {
  type FetchContext,
  getFetchLog,
} from "../src/core/store/paper-asset.ts";
import {
  broadcastPapersChanged,
  buildAssetSnapshot,
  deleteLocalPdf,
  enqueueFetch,
  ensureStubPaper,
  fetchQueueStatus,
  hydrateAssets,
  postFetchSuccess,
  reconcileOrphans,
  assertSafePaperId,
  type PaperAssetDeps,
} from "./paper-asset-ipc.ts";
import {
  type DigestAiMeta, type DigestAiProgressFn, DIGEST_PREVIEW_BLURB_SAMPLES,
  digestSummarizeOpts, generateDigestBlurb, mergeAiOntoToday,
  pickAbstractTargets, pickBlurbTargets, pickTopNTargets, readCachedSummary,
} from "../src/core/subs/digest-ai.ts";

export interface IpcDeps {
  store: Store;
  secrets: SecretStore;
}

function broadcastSubsUpdated(payload: Record<string, unknown> = {}): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) try { w.webContents.send("subs:updated", payload); } catch { /* ignore */ }
  }
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

import { registerCiteExport } from "./ipc-cite-export.ts";

export function registerIpc(deps: IpcDeps): void {
  const { store, secrets } = deps;
  registerCiteExport();

  async function buildSearchOpts(): Promise<SearchOpts> {
    const settings = await loadAppSettings(store);
    const limit = settings.searchDepth === "full" ? 50 : 25;
    const keys: Record<string, string> = {};
    const ss = await secrets.get("semanticscholar_key");
    if (ss) keys.semanticscholar = ss;
    const core = await secrets.get("core_key");
    if (core) keys.core = core;
    const lens = await secrets.get("lens_token");
    if (lens) keys.lens = lens;
    const ncbi = await secrets.get("ncbi_key");
    if (ncbi) keys.ncbi = ncbi;
    return { limit, keys, disabledSources: settings.disabledSources ?? [] };
  }

  async function buildDigestSearchOpts(preview = false): Promise<SearchOpts> {
    return applyDigestSearchOpts(await buildSearchOpts(), preview);
  }
  digestSearchOptsFactory = (preview = false) => buildDigestSearchOpts(preview);

  async function contactEmail(): Promise<string | undefined> {
    const s = await loadAppSettings(store);
    return s.contactEmail ?? process.env.LUMINA_CONTACT_EMAIL;
  }

  const pdfDir = (): string => { const d = path.join(app.getPath("userData"), "pdfs"); fs.mkdirSync(d, { recursive: true }); return d; };
  const pdfPath = (id: string): string => path.join(pdfDir(), encodeURIComponent(id) + ".pdf");
  const prefetchInflight = new Set<string>();
  let paperAssetDepsRef: PaperAssetDeps | null = null;
  const getPaperAssetDeps = (): PaperAssetDeps | null => paperAssetDepsRef;

  function searchLocalByTitle(titleQ: string): Paper[] {
    try {
      const spec = rawToSpec(titleQ + "[title]", {});
      const res = store.papers.search(spec, { limit: 8, sort: "relevance" });
      return (res.hits || []).map((r) => r.paper);
    } catch {
      return [];
    }
  }

  function mergePrimaryFirst(primaryList: Paper[], fullList: Paper[]): Paper[] {
    const byId = new Map<string, Paper>();
    for (const p of primaryList) byId.set(p.id, p);
    for (const p of fullList) if (!byId.has(p.id)) byId.set(p.id, p);
    return [...byId.values()];
  }

  ipcMain.handle("search:online", async (e, raw: string, filters) => {
    const opts = await buildSearchOpts();
    const kind = classifyInput(String(raw || "").trim());
    if (kind !== "text") {
      const resolved = await resolveIdentifierInput(String(raw || "").trim(), opts);
      if (resolved.ok) {
        store.papers.upsert(resolved.paper);
        scheduleIdentifierPrefetch(e.sender, resolved.paper.id, resolved.resolvedFrom);
        return {
          perSource: { resolve: { ok: true, count: 1 } },
          count: 1,
          papers: [resolved.paper],
          locateMode: "identifier",
          resolvedFrom: resolved.resolvedFrom,
        };
      }
      if (resolved.reason === "not_identifier") {
        /* fall through */
      } else {
        // P7 · 标识符解析失败 → 回落关键词检索（消歧）
        const spec = rawToSpec(raw, filters);
        const agg = await aggregateSearch(spec, opts);
        store.papers.upsertMany(agg.papers);
        return {
          perSource: agg.perSource,
          count: agg.papers.length,
          papers: agg.papers,
          locateMode: "disambig",
          identifierError: resolved.message || resolved.reason,
        };
      }
    }
    const spec = rawToSpec(raw, filters);
    const field = spec.filters.field ?? "all";
    const titleQ = titleQueryText(raw);
    if (isTitleLikeQuery(raw, field) && titleQ.length >= 8) {
      const locals = searchLocalByTitle(titleQ);
      const fast = await titleFastLane(spec, titleQ, opts, locals);
      if (fast.papers.length) {
        store.papers.upsertMany(fast.papers);
        const primary = pickPrimaryHit(fast.papers, titleQ, field);
        const agg = await aggregateSearch(spec, opts);
        store.papers.upsertMany(agg.papers);
        const merged = mergePrimaryFirst(fast.papers, agg.papers);
        if (primary?.paperId) scheduleLocatePrefetch(e.sender, primary.paperId, ["title_fast_lane"], "primary");
        return {
          perSource: { ...fast.perSource, ...agg.perSource },
          count: merged.length,
          papers: merged,
          locateMode: primary ? "primary" : "keyword",
          primaryPaperId: primary?.paperId,
          primaryAmbiguous: primary?.ambiguous,
        };
      }
    }
    const agg = await aggregateSearch(spec, opts);
    store.papers.upsertMany(agg.papers);
    const primary = isTitleLikeQuery(raw, field) ? pickPrimaryHit(agg.papers, titleQ, field) : null;
    return {
      perSource: agg.perSource,
      count: agg.papers.length,
      papers: agg.papers,
      locateMode: primary ? "primary" : "keyword",
      primaryPaperId: primary?.paperId,
      primaryAmbiguous: primary?.ambiguous,
    };
  });

  // 渐进式检索：Title Fast Lane 首包 + 各源增量；慢源不拖累首屏。
  ipcMain.handle("search:online-stream", async (e, raw: string, filters, reqId) => {
    const opts = await buildSearchOpts();
    const send = (payload: unknown) => { try { e.sender.send("search:stream", payload); } catch { /* 渲染层已关则忽略 */ } };
    const kind = classifyInput(String(raw || "").trim());
    if (kind !== "text") {
      const resolved = await resolveIdentifierInput(String(raw || "").trim(), opts);
      if (resolved.ok) {
        store.papers.upsert(resolved.paper);
        send({
          reqId,
          source: "resolve",
          papers: [resolved.paper],
          perSource: { resolve: { ok: true, count: 1 } },
          done: true,
          locateMode: "identifier",
          resolvedFrom: resolved.resolvedFrom,
        });
        scheduleIdentifierPrefetch(e.sender, resolved.paper.id, resolved.resolvedFrom);
        return { ok: true };
      }
      if (resolved.reason !== "not_identifier") {
        // P7 · 标识符失败 → 关键词回落
        const spec = rawToSpec(raw, filters);
        send({
          reqId,
          source: "resolve",
          papers: [],
          perSource: { resolve: { ok: false, count: 0, error: resolved.message || resolved.reason } },
          done: false,
          locateMode: "disambig",
          identifierError: resolved.message || resolved.reason,
        });
        const agg = await aggregateSearchStream(spec, opts, (source, snapshot, perSource) => {
          send({ reqId, source, papers: snapshot, perSource, done: false, locateMode: "disambig" });
        });
        store.papers.upsertMany(agg.papers);
        send({ reqId, papers: agg.papers, perSource: agg.perSource, done: true, locateMode: "disambig", identifierError: resolved.message || resolved.reason });
        return { ok: true };
      }
    }
    const agg = await runLocateKeywordStream(raw, filters, opts, (payload) => {
      send({ reqId, ...payload });
      if (payload.done && payload.primaryPaperId && payload.locateMode === "primary") {
        scheduleLocatePrefetch(e.sender, payload.primaryPaperId, payload.resolvedFrom ?? ["title_fast_lane"], "primary");
      }
    }, (titleQ) => searchLocalByTitle(titleQ));
    store.papers.upsertMany(agg.papers);
    return { ok: true };
  });

  ipcMain.handle("search:resolve-identifier", async (_e, raw: string) => {
    const opts = await buildSearchOpts();
    const resolved = await resolveIdentifierInput(String(raw || "").trim(), opts);
    if (resolved.ok) store.papers.upsert(resolved.paper);
    return resolved;
  });

  ipcMain.handle("search:retry-source", async (_e, sourceId: string, raw: string, filters) => {
    const spec = rawToSpec(raw, filters);
    const opts = await buildSearchOpts();
    const s = await searchSingleSource(String(sourceId).toLowerCase(), spec, opts);
    if (s.papers.length) store.papers.upsertMany(s.papers);
    const st = s.error
      ? { count: 0, ok: false, error: s.error }
      : { count: s.hits.length, ok: true };
    return { sourceId: s.id, perSource: { [s.id]: st }, papers: s.papers };
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
  ipcMain.handle("summaries:get", (_e, paperId: string, depth = "tldr", language = "zh") => {
    return readCachedSummary(store.db, paperId, depth, language);
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

  // 统一候选链取文：OA → LibGen → Anna → Sci-Hub，成功则落盘 + fetch_log + 可选自动入库。
  async function runFetchPaper(
    paperId: string,
    onTrace?: import("../src/core/oa/fetch-trace.ts").FetchTraceCallback,
    ctx: FetchContext = {},
  ) {
    const paper = store.papers.getById(paperId);
    if (!paper) return { ok: false as const, reason: "not_found" };
    try {
      if (fs.existsSync(pdfPath(paperId))) {
        const log = getFetchLog(store.db, paperId);
        return { ok: true as const, source: log?.source || "cached", cached: true };
      }
    } catch { /* ignore */ }
    const settings = await loadAppSettings(store);
    const email = settings.contactEmail ?? process.env.LUMINA_CONTACT_EMAIL;
    const coreKey = (await secrets.get("core_key")) ?? undefined;
    const overall = attemptSignal(undefined, 120_000);
    try {
      const res = await fetchPaperPdf(paper, {
        email,
        includeAltSources: true,
        coreKey,
        mirrorSettings: settings.altMirrors,
        onTrace,
        signal: overall.signal,
        perAttemptTimeoutMs: 22_000,
      });
      if (!res.ok && shouldSignalMissingEmail(paper.doi, email)) {
        return { ok: false as const, reason: "missing_email", hint: "configure_contact_email" };
      }
      if (res.ok) {
        try { fs.writeFileSync(pdfPath(paperId), Buffer.from(res.bytes)); } catch { /* 落盘失败不阻断 */ }
        const deps = getPaperAssetDeps();
        if (deps) await postFetchSuccess(deps, paperId, res.source || "unknown", ctx);
      }
      return res;
    } finally {
      overall.clear();
    }
  }

  function scheduleLocatePrefetch(
    sender: WebContents,
    paperId: string,
    resolvedFrom: string[] | undefined,
    locateMode: "identifier" | "primary",
  ): void {
    void (async () => {
      const settings = await loadAppSettings(store);
      const paper = store.papers.getById(paperId);
      const hasPdf = fs.existsSync(pdfPath(paperId));
      if (hasPdf) {
        try {
          sender.send("prefetch:done", { paperId, result: { ok: true, source: "cached", cached: true } });
        } catch { /* 渲染层已关 */ }
        return;
      }
      if (!shouldPrefetchOnLocate(locateMode, resolvedFrom, paper, settings, false)) return;
      if (prefetchInflight.has(paperId)) return;
      prefetchInflight.add(paperId);
      try {
        try { sender.send("prefetch:start", { paperId }); } catch { /* 渲染层已关 */ }
        const res = await runFetchPaper(paperId, undefined, { channel: "prefetch", provenance: "find_fetch" });
        try {
          if (res.ok) sender.send("prefetch:done", { paperId, result: res });
          else sender.send("prefetch:fail", { paperId, result: res });
        } catch { /* 渲染层已关 */ }
      } catch (e) {
        try {
          sender.send("prefetch:fail", { paperId, result: { ok: false, reason: String((e as Error)?.message || e) } });
        } catch { /* 渲染层已关 */ }
      } finally { prefetchInflight.delete(paperId); }
    })();
  }

  function scheduleIdentifierPrefetch(
    sender: WebContents,
    paperId: string,
    resolvedFrom: string[] | undefined,
  ): void {
    scheduleLocatePrefetch(sender, paperId, resolvedFrom, "identifier");
  }

  ipcMain.handle("oa:fetchPaper", async (_e, paperId: string, ctx?: FetchContext) => {
    try {
      return await runFetchPaper(paperId, undefined, ctx || {});
    } catch (e: unknown) {
      const msg = (e && (e as { message?: unknown }).message) ? String((e as { message?: unknown }).message) : "取文失败";
      console.error("oa:fetchPaper 失败", paperId, msg);
      const paper = store.papers.getById(paperId);
      const settings = await loadAppSettings(store);
      const email = settings.contactEmail ?? process.env.LUMINA_CONTACT_EMAIL;
      if (paper && shouldSignalMissingEmail(paper.doi, email)) {
        return { ok: false, reason: "missing_email", hint: "configure_contact_email" };
      }
      return { ok: false, reason: msg };
    }
  });

  ipcMain.handle("oa:fetchPaper-stream", async (e, paperId: string, reqId: number, ctx?: FetchContext) => {
    const send = (payload: unknown) => {
      try { e.sender.send("fetch:progress", { reqId, paperId, ...(payload as object) }); } catch { /* 渲染层已关 */ }
    };
    try {
      const res = await runFetchPaper(paperId, (ev) => send(ev), ctx || {});
      send({ type: "final", result: res });
      return res;
    } catch (err: unknown) {
      const msg = String((err as Error)?.message || err || "取文失败");
      const fail = { ok: false as const, reason: msg };
      send({ type: "final", result: fail });
      return fail;
    }
  });

  ipcMain.handle("mirrors:probe", async () => {
    const settings = await loadAppSettings(store);
    return probeAllMirrors(settings.altMirrors);
  });

  ipcMain.handle("settings:get", () => loadAppSettingsView(store));
  ipcMain.handle("settings:save", async (_e, s) => {
    await saveAppSettings(store, s);
    const cur = await loadAppSettings(store);
    setPoliteIdentity({ tool: "lumina-feed", email: cur.contactEmail ?? process.env.LUMINA_CONTACT_EMAIL });
    return true;
  });
  ipcMain.handle("sources:status", async () => {
    const names = ["semanticscholar_key", "core_key", "lens_token", "ncbi_key"] as const;
    const out: Record<string, boolean> = {};
    for (const n of names) out[n] = !!(await secrets.get(n));
    return out;
  });
  ipcMain.handle("sources:registry", async () => {
    const settings = await loadAppSettings(store);
    const disabled = new Set((settings.disabledSources ?? []).map((s) => s.toLowerCase()));
    return listSourceRegistry().map((row) => ({
      ...row,
      enabled: !disabled.has(row.id),
    }));
  });
  ipcMain.handle("sources:test", async (_e, secretName: string, candidate?: string) => {
    const key = candidate || await secrets.get(secretName);
    if (!key) return { ok: false, error: "no_key" };
    const t0 = Date.now();
    const f = fetch;
    try {
      if (secretName === "semanticscholar_key") {
        const res = await f(`https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1`, {
          headers: { accept: "application/json", "x-api-key": key },
        });
        return { ok: res.ok, ms: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` };
      }
      if (secretName === "core_key") {
        const res = await f("https://api.core.ac.uk/v3/search/works?q=test&limit=1", {
          headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
        });
        return { ok: res.ok, ms: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` };
      }
      if (secretName === "lens_token") {
        const res = await f("https://api.lens.org/scholarly/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: { query_string: { query: "test" } }, size: 1 }),
        });
        return { ok: res.ok, ms: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` };
      }
      if (secretName === "ncbi_key") {
        const res = await f("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=test&retmax=1&api_key=" + encodeURIComponent(key));
        return { ok: res.ok, ms: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` };
      }
      return { ok: false, error: "unknown_secret" };
    } catch (e: unknown) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  });
  ipcMain.handle("secrets:set", (_e, key: string, value: string) => secrets.set(key, value));
  ipcMain.handle("secrets:has", async (_e, key: string) => !!(await secrets.get(key)));
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

  // ── 继续阅读（持久化 LRU · 元数据 only）──
  const enrichContinueRow = (row: ReadingHistoryRow): { title?: string; missing?: boolean; hasPdf?: boolean } => {
    if (row.kind === "paper" && row.paper_id) {
      const paper = store.papers.getById(row.paper_id);
      const hasPdf = fs.existsSync(pdfPath(row.paper_id));
      return { title: paper?.title || row.title, missing: !hasPdf, hasPdf };
    }
    if (row.kind === "local" && row.local_path) {
      const ok = isSafeLocalPdfPath(row.local_path);
      return { title: row.title, missing: !ok, hasPdf: ok };
    }
    return { title: row.title, missing: true, hasPdf: false };
  };

  ipcMain.handle("reader:continueList", () => {
    ensureReadingHistoryTable(store.db);
    return listContinueReading(store.db, enrichContinueRow);
  });

  ipcMain.handle("reader:recordOpen", (_e, payload: { paperId?: string; localPath?: string; title?: string; page?: number }) => {
    if (!payload || (!payload.paperId && !payload.localPath)) return { ok: false };
    if (payload.localPath && typeof (app as { addRecentDocument?: (p: string) => void }).addRecentDocument === "function") {
      try { app.addRecentDocument(normalizeLocalPath(payload.localPath)); } catch { /* ignore */ }
    }
    const entry = recordReadingOpen(store.db, {
      paperId: payload.paperId,
      localPath: payload.localPath,
      title: payload.title || payload.paperId || path.basename(String(payload.localPath || "")) || "PDF",
      page: payload.page,
    });
    return { ok: !!entry, entry };
  });

  ipcMain.handle("reader:recordPage", (_e, entryKey: string, page: number) => {
    if (!entryKey) return { ok: false };
    touchReadingPage(store.db, entryKey, page);
    return { ok: true };
  });

  ipcMain.handle("reader:readLocalPdf", (_e, localPath: string) => {
    try {
      if (!isSafeLocalPdfPath(localPath)) return null;
      return new Uint8Array(fs.readFileSync(normalizeLocalPath(localPath)));
    } catch { return null; }
  });

  ipcMain.handle("reader:removeContinue", (_e, entryKey: string) => ({
    ok: removeReadingHistory(store.db, String(entryKey || "")),
  }));

  ipcMain.handle("reader:clearContinue", () => {
    clearReadingHistory(store.db);
    return { ok: true };
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
    try {
      assertSafePaperId(paperId, pdfDir);
      const p = pdfPath(paperId);
      if (!fs.existsSync(p)) return null;
      return new Uint8Array(fs.readFileSync(p));
    } catch { return null; }
  });
  // 列出已下载全文（关联 store 取标题；按最近打开 / 文件时间排序）。
  ipcMain.handle("oa:listPdfs", () => {
    try {
      ensureReadingHistoryTable(store.db);
      const dir = pdfDir();
      const items = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).map((f) => {
        const id = decodeURIComponent(f.slice(0, -4));
        const paper = store.papers.getById(id);
        let mtime: string | undefined;
        try { mtime = fs.statSync(path.join(dir, f)).mtime.toISOString(); } catch { /* ignore */ }
        const openedAt = openedAtForPaper(store.db, id) || mtime;
        return { paperId: id, title: paper ? paper.title : undefined, oaUrl: paper ? paper.oaUrl : undefined, openedAt, mtime };
      });
      items.sort((a, b) => String(b.openedAt || "").localeCompare(String(a.openedAt || "")));
      return items;
    } catch { return []; }
  });

  // 大模型就绪：已选提供方+模型；云端还需钥匙串密钥（Ollama 免密钥）。
  const checkLlmReady = async () => {
    const settings = await loadAppSettings(store);
    const llm = settings.llm;
    if (!llm || !llm.provider || !llm.model) {
      return { ok: false as const, reason: "no_config", message: "请先在「设置 → 大模型」选择提供方并填写模型。" };
    }
    if (llm.provider !== "ollama") {
      const key = await secrets.get(`${llm.provider}_key`);
      if (!key) {
        return { ok: false as const, reason: "no_key", message: "请先在「设置 → 大模型」保存 API Key。" };
      }
    }
    return { ok: true as const, provider: llm.provider, model: llm.model };
  };
  ipcMain.handle("llm:status", () => checkLlmReady());

  // ── reader_engine：阅读器接地 AI（对逐页文本总结/问答，带页码引用；只单篇）──
  const makeLlm = async () => {
    const status = await checkLlmReady();
    if (!status.ok) throw new Error(status.message || "未配置 LLM");
    const settings = await loadAppSettings(store);
    return llmFromConfig(settings.llm!, () => secrets.get(`${settings.llm!.provider}_key`));
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
    const status = await checkLlmReady();
    if (!status.ok) return { ok: false, error: status.message || "未配置大模型" };
    try {
      const llm = await makeLlm();
      const text = await translateText((payload && payload.text) || "", llm);
      return { ok: true, text, model: llm.model };
    } catch (e: unknown) {
      const msg = (e && (e as { message?: unknown }).message) ? String((e as { message?: unknown }).message) : "翻译失败";
      return { ok: false, error: msg };
    }
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
      const norm = normalizeSubscription(sub);
      const sv = norm.id ? norm : { ...norm, id: "s" + Date.now() };
      store.db.prepare("INSERT INTO subscriptions(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
        .run(sv.id as string, JSON.stringify(sv), new Date().toISOString());
      return sv;
    } catch { return sub; }
  });
  ipcMain.handle("subs:remove", (_e, id: string) => {
    try {
      ensureSubs();
      store.db.prepare("DELETE FROM subscriptions WHERE id=?").run(id);
      broadcastSubsUpdated({ removed: id });
      return true;
    } catch { return false; }
  });
  // 立即运行：构造检索式（关键词走 rawToSpec；期刊走 journal 字段，PubMed [Journal] 接受 ISSN/刊名，限非预印本源）→ 真检索 → 落库；
  // 成本闸 autoSummarize 限制自动总结范围（off/abstract/topN）。今日命中以引擎 Paper 返回，渲染层经 toCardModel 映射。
  ipcMain.handle("subs:runNow", async (e, sub: any, opts?: { asyncAi?: boolean }) =>
    runSubscriptionNow(sub, store, secrets, () => buildDigestSearchOpts(false), { sender: e.sender, asyncAi: opts?.asyncAi !== false }));
  ipcMain.handle("subs:preview", async (e, draft: any) =>
    runSubscriptionNow(draft, store, secrets, () => buildDigestSearchOpts(true), { preview: true, sender: e.sender }));

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
        let paper = store.papers.getById(r.paper_id);
        if (!paper) {
          const deps = getPaperAssetDeps();
          if (deps) ensureStubPaper(deps, r.paper_id);
          paper = store.papers.getById(r.paper_id);
        }
        if (!paper) continue;
        const st = summaryOf(r.paper_id);
        let hasFull = false; try { hasFull = fs.existsSync(pdfPath(r.paper_id)); } catch { /* ignore */ }
        let annoCount = 0, annoText = "";
        try {
          const a = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("anno:paper:" + r.paper_id) as { payload?: string } | undefined;
          if (a && a.payload) { const al = JSON.parse(a.payload); if (Array.isArray(al)) { annoCount = al.length; annoText = al.map((x: any) => `${x.anchoredText || ""} ${x.note || ""}`).join(" ").trim(); } }
        } catch { /* ignore */ }
        out.push({
          paper,
          provenance: r.provenance,
          addedAt: r.added_at,
          hasFull,
          hasSummary: !!st,
          summaryText: st || "",
          annoCount,
          annoText,
          fetchSource: getFetchLog(store.db, r.paper_id)?.source ?? null,
          fetchedAt: getFetchLog(store.db, r.paper_id)?.fetched_at ?? null,
        });
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

  paperAssetDepsRef = { store, pdfPath, pdfDir, ftsPrep, ensureLib, ensureFts };

  ipcMain.handle("papers:hydrate", () => {
    try {
      const deps = getPaperAssetDeps();
      if (!deps) return {};
      return hydrateAssets(deps);
    } catch { return {}; }
  });
  ipcMain.handle("papers:reconcile", async () => {
    try {
      const deps = getPaperAssetDeps();
      if (!deps) return { added: 0 };
      return await reconcileOrphans(deps);
    } catch { return { added: 0 }; }
  });
  ipcMain.handle("papers:asset", (_e, paperId: string) => {
    try {
      const deps = getPaperAssetDeps();
      if (!deps) return null;
      return buildAssetSnapshot(deps, paperId);
    } catch { return null; }
  });
  ipcMain.handle("pdf:delete", (_e, paperId: string, opts?: { removeFromLibrary?: boolean }) => {
    try {
      const deps = getPaperAssetDeps();
      if (!deps) return false;
      return deleteLocalPdf(deps, paperId, opts?.removeFromLibrary !== false);
    } catch { return false; }
  });
  ipcMain.handle("papers:enqueueFetch", (e, jobs: Array<{ paperId: string; provenance?: string; channel?: string }>) => {
    try {
      return enqueueFetch(
        (jobs || []).map((j) => ({ paperId: j.paperId, ctx: { provenance: j.provenance, channel: j.channel } })),
        e.sender,
        (paperId, onTrace, ctx) => runFetchPaper(paperId, onTrace as import("../src/core/oa/fetch-trace.ts").FetchTraceCallback, ctx),
      );
    } catch { return { queued: 0 }; }
  });
  ipcMain.handle("papers:fetchQueueStatus", () => fetchQueueStatus());

  // 清除本机文献数据（库 + 已下载 PDF + 缓存表）；设置与钥匙串密钥保留。完成后重启应用。
  ipcMain.handle("app:resetLocalData", () => {
    try {
      const ud = app.getPath("userData");
      try { store.db.close?.(); } catch { /* ignore */ }
      for (const f of ["lumina.db", "lumina.db-wal", "lumina.db-shm"]) {
        try { fs.unlinkSync(path.join(ud, f)); } catch { /* ignore */ }
      }
      const pd = path.join(ud, "pdfs");
      try {
        for (const name of fs.readdirSync(pd)) {
          try { fs.unlinkSync(path.join(pd, name)); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      app.relaunch();
      app.quit();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && (e as Error).message) || "reset_failed" };
    }
  });
}

// ── 订阅运行核心（手动 runNow / preview / 调度器共用）──
let digestSearchOptsFactory: (preview?: boolean) => Promise<SearchOpts> = async () => ({ limit: 25 });

function ensureSubsTable(db: Store["db"]): void {
  db.exec("CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);");
}

function emitSubsProgress(sender: WebContents | undefined, subId: string, p: Omit<import("../src/core/subs/digest-ai.ts").DigestAiProgress, "subId">): void {
  if (!sender || sender.isDestroyed()) return;
  try { sender.send("subs:progress", { subId, ...p }); } catch { /* ignore */ }
}

async function runDigestAiPhase(
  mode: string,
  norm: Record<string, unknown>,
  todayMerged: Paper[],
  fresh: Paper[],
  preview: boolean,
  store: Store,
  secrets: SecretStore,
  subId: string,
  onProgress?: DigestAiProgressFn,
): Promise<{ patchById: Map<string, Record<string, unknown>>; aiMeta: DigestAiMeta }> {
  const patchById = new Map<string, Record<string, unknown>>();
  const aiMeta: DigestAiMeta = { status: "skipped", mode, processed: 0, total: 0, blurbs: 0, summaries: 0, errors: 0 };
  if (mode === "off") {
    aiMeta.skippedReason = "autoSummarize_off";
    return { patchById, aiMeta };
  }
  const settings = await loadAppSettings(store);
  if (!settings.llm) {
    aiMeta.skippedReason = "llm_not_configured";
    return { patchById, aiMeta };
  }
  let llm: Awaited<ReturnType<typeof llmFromConfig>>;
  try {
    llm = await llmFromConfig(settings.llm, () => secrets.get(`${settings.llm!.provider}_key`));
  } catch {
    aiMeta.status = "failed";
    aiMeta.skippedReason = "llm_init_failed";
    return { patchById, aiMeta };
  }
  const fullText = makeOaFullTextProvider({ email: settings.contactEmail, includeAltSources: true });
  const cache = sqliteSummaryCache(store.db);

  if (mode === "blurb") {
    const targets = preview ? todayMerged.slice(0, DIGEST_PREVIEW_BLURB_SAMPLES) : pickBlurbTargets(todayMerged);
    aiMeta.total = targets.length;
    aiMeta.status = targets.length ? "partial" : "ok";
    let i = 0;
    for (const pp of targets) {
      i++;
      onProgress?.({ subId, phase: "ai", mode: "blurb", current: i, total: targets.length, label: `生成相关说明 ${i}/${targets.length}` });
      try {
        const blurb = await generateDigestBlurb(pp, norm, llm);
        if (blurb) {
          patchById.set(pp.id, { _digestBlurb: blurb });
          aiMeta.blurbs++;
        }
      } catch { aiMeta.errors = (aiMeta.errors || 0) + 1; }
      aiMeta.processed = i;
    }
  } else if (mode === "abstract" || mode === "topN") {
    const targets = preview ? fresh.slice(0, 2) : (mode === "topN" ? pickTopNTargets(fresh) : pickAbstractTargets(fresh));
    const sumOpts = digestSummarizeOpts(mode);
    aiMeta.total = targets.length;
    aiMeta.status = targets.length ? "partial" : "ok";
    let i = 0;
    for (const pp of targets) {
      i++;
      onProgress?.({ subId, phase: "ai", mode: mode as "abstract" | "topN", current: i, total: targets.length, label: `自动总结 ${i}/${targets.length}` });
      try {
        const r = await summarizeGrounded(pp, sumOpts, { llm, fullText, cache, ground: {} });
        if (r) {
          saveGrounding(store.db, pp.id, r.model, r.sourceBasis, r.grounded);
          patchById.set(pp.id, { _digestSummary: r.summaryText, _digestSummaryBasis: r.sourceBasis });
          aiMeta.summaries++;
        }
      } catch { aiMeta.errors = (aiMeta.errors || 0) + 1; }
      aiMeta.processed = i;
    }
  }
  aiMeta.status = (aiMeta.errors || 0) > 0 && aiMeta.processed === 0 ? "failed" : (aiMeta.errors || 0) > 0 ? "partial" : "ok";
  return { patchById, aiMeta };
}

async function persistSubscriptionToday(
  store: Store,
  norm: Record<string, unknown>,
  todayMerged: Paper[],
  seen: Set<string>,
  fresh: Paper[],
  meta: DigestRunMeta,
): Promise<void> {
  ensureSubsTable(store.db);
  const deliveredFresh = fresh.filter((p) => todayMerged.some((t) => t.id === p.id)).map((p) => p.id);
  const newSeen = [...seen, ...deliveredFresh].slice(-500);
  const next = {
    ...norm,
    today: todayMerged,
    lastRunAt: new Date().toISOString(),
    seenIds: newSeen,
    lastRunMeta: meta,
  };
  store.db.prepare("INSERT INTO subscriptions(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
    .run(String(norm.id ?? ""), JSON.stringify(next), next.lastRunAt as string);
}

async function runSubscriptionNow(
  sub: any,
  store: Store,
  secrets: SecretStore,
  optsFactory?: (preview?: boolean) => Promise<SearchOpts>,
  flags: { preview?: boolean; asyncAi?: boolean; sender?: WebContents } = {},
): Promise<{ ok: boolean; hits: any[]; newCount?: number; perSource?: DigestRunMeta["perSource"]; meta?: DigestRunMeta; preview?: boolean; aiSkippedReason?: string }> {
  const preview = !!flags.preview;
  const asyncAi = !preview && flags.asyncAi !== false;
  const sender = flags.sender;
  const t0 = Date.now();
  try {
    const norm = normalizeSubscription(sub) as Record<string, unknown>;
    const subId = String(norm.id || "preview");
    const spec = buildDigestSpec(norm);
    if (!spec) return { ok: false, hits: [], preview };
    const getOpts = optsFactory ?? digestSearchOptsFactory;
    const searchOpts = await getOpts(preview);
    emitSubsProgress(sender, subId, { phase: "search", mode: "off", current: 0, total: 1, label: "检索中…" });
    const agg = await aggregateSearch(spec, searchOpts);
    if (!preview) store.papers.upsertMany(agg.papers);
    const seen = new Set<string>(Array.isArray(norm.seenIds) ? (norm.seenIds as string[]) : []);
    const prevToday = Array.isArray(norm.today) ? (norm.today as Paper[]) : [];
    const fresh = preview ? agg.papers.slice(0, 5) : freshHits(agg.papers, [...seen]);
    let todayMerged = preview
      ? fresh
      : (() => {
          const freshIds = new Set(fresh.map((p) => p.id));
          const carry = prevToday.filter((p) => p && p.id && !freshIds.has(p.id));
          return [...fresh, ...carry].slice(0, 50);
        })();
    const mode = (norm.autoSummarize as string) || "off";
    const meta: DigestRunMeta = {
      perSource: agg.perSource,
      durationMs: Date.now() - t0,
      mergedCount: agg.mergedCount ?? agg.papers.length,
      preview,
    };

    const onProgress: DigestAiProgressFn = (p) => emitSubsProgress(sender, subId, p);

    if (mode !== "off") {
      if (asyncAi && !preview) {
        meta.ai = { status: "queued", mode, processed: 0, total: 0, blurbs: 0, summaries: 0 };
        if (!preview) {
          await persistSubscriptionToday(store, norm, todayMerged, seen, fresh, meta);
        }
        void (async () => {
          try {
            const { patchById, aiMeta } = await runDigestAiPhase(mode, norm, todayMerged, fresh, false, store, secrets, subId, onProgress);
            todayMerged = mergeAiOntoToday(todayMerged, patchById);
            meta.ai = aiMeta;
            meta.durationMs = Date.now() - t0;
            await persistSubscriptionToday(store, norm, todayMerged, seen, fresh, meta);
            emitSubsProgress(sender, subId, { phase: "ai", mode: mode as "blurb", current: aiMeta.processed, total: aiMeta.total, label: "AI 完成" });
            if (sender && !sender.isDestroyed()) sender.send("subs:updated", { subId, ai: aiMeta });
          } catch {
            if (sender && !sender.isDestroyed()) sender.send("subs:updated", { subId, ai: { status: "failed", mode } });
          }
        })();
        return { ok: true, hits: todayMerged, newCount: fresh.length, perSource: meta.perSource, meta, preview, aiSkippedReason: undefined };
      }
      const { patchById, aiMeta } = await runDigestAiPhase(mode, norm, todayMerged, fresh, preview, store, secrets, subId, onProgress);
      todayMerged = mergeAiOntoToday(todayMerged, patchById);
      meta.ai = aiMeta;
    } else {
      meta.ai = { status: "skipped", mode: "off", processed: 0, total: 0, blurbs: 0, summaries: 0, skippedReason: "autoSummarize_off" };
    }

    meta.durationMs = Date.now() - t0;
    if (!preview) {
      try {
        await persistSubscriptionToday(store, norm, todayMerged, seen, fresh, meta);
      } catch { /* 持久化失败不阻断 */ }
    }
    return {
      ok: true,
      hits: todayMerged,
      newCount: fresh.length,
      perSource: meta.perSource,
      meta,
      preview,
      aiSkippedReason: meta.ai?.skippedReason,
    };
  } catch {
    return { ok: false, hits: [], preview };
  }
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
/** 订阅调度器：启动后 ~30s 跑一次，此后每 ~10 分钟检查到期订阅并真检索。通知档位见 settings.digestNotifyTier。 */
export function startSubsScheduler(store: Store, secrets: SecretStore): void {
  const tick = async () => {
    try {
      ensureSubsTable(store.db);
      const settings = await loadAppSettings(store);
      const tier = settings.digestNotifyTier || "regular";
      const notify = settings.notifications !== false;
      const rows = store.db.prepare("SELECT payload FROM subscriptions").all() as Array<{ payload: string }>;
      const now = new Date();
      let batchTotal = 0;
      const batchNames: string[] = [];
      for (const row of rows) {
        let sub: any; try { sub = normalizeSubscription(JSON.parse(row.payload)); } catch { continue; }
        if (!isSubDue(sub, now)) continue;
        const res = await runSubscriptionNow(sub, store, secrets, digestSearchOptsFactory, { asyncAi: false });
        if (res.ok && (res.newCount ?? res.hits.length)) {
          const n = res.newCount ?? res.hits.length;
          if (n <= 0) continue;
          batchTotal += n;
          batchNames.push(String(sub.name || sub.q || "订阅").slice(0, 24));
          if (notify && tier === "power") {
            try {
              if (Notification.isSupported()) {
                new Notification({
                  title: `Lumina · ${sub.name || sub.q || "订阅"}`,
                  body: `新增 ${n} 条 · 打开简报查看`,
                }).show();
              }
            } catch { /* ignore */ }
          }
        }
      }
      if (notify && tier === "regular" && batchTotal > 0) {
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: "Lumina · 今日证据简报",
              body: `共 ${batchTotal} 条新命中${batchNames.length ? "（" + batchNames.slice(0, 3).join("、") + (batchNames.length > 3 ? "…" : "") + "）" : ""}`,
            }).show();
          }
        } catch { /* ignore */ }
      }
    } catch { /* 调度循环不抛 */ }
  };
  setTimeout(() => { void tick(); }, 30 * 1000);
  setInterval(() => { void tick(); }, 10 * 60 * 1000);
}
