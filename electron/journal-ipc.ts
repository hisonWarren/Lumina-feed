// lumina-feed · 期刊信息工具 IPC（live 查询 + 手动更新数据集）
// 数据策略：OpenAlex/DOAJ 每次 live 查询；SCImago 分区、预警名单为「在线拉取 + 手动更新」磁盘缓存。
import { ipcMain, app, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DatasetInfo, WarningEntry } from "../src/core/journal/types.ts";
import { lookupJournal } from "../src/core/journal/lookup.ts";
import {
  parseScimagoCsv, fetchScimagoCsv, SCIMAGO_CSV_URL, SCIMAGO_HOMEPAGE, type ScimagoDataset,
} from "../src/core/journal/scimago.ts";
import {
  parseWarningJson, WARNING_HOMEPAGE, EMPTY_WARNING_DATASET,
  BUILTIN_WARNING_YEAR, BUILTIN_WARNING_SOURCE, BUILTIN_WARNING_ENTRIES, type WarningDataset,
} from "../src/core/journal/warning-list.ts";
import {
  parseWosJifTable, crawlWosJifDataset, WOS_JIF_HOMEPAGE, WOS_JIF_SOURCE, type WosJifDataset,
} from "../src/core/journal/wos-jif.ts";
import {
  parseCasPartitionTable, crawlCasPartitionDataset, LETPUB_HOMEPAGE, LETPUB_SOURCE, type CasPartitionDataset,
} from "../src/core/journal/cas-partition.ts";
import { structureWarningEntries } from "../src/core/journal/warning-structure.ts";
import { llmFromConfig } from "../src/core/summarize/llm-client.ts";
import { PROVIDER_DEFAULT_MODEL } from "../src/core/summarize/model-presets.ts";
import { hydrateLlmSettings } from "./settings.ts";
import type { IpcDeps } from "./ipc.ts";

function dataDir(): string {
  const d = path.join(app.getPath("userData"), "journal-data");
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  return d;
}
const scimagoPath = () => path.join(dataDir(), "scimago.json");
const warningPath = () => path.join(dataDir(), "warning.json");
const jifPath = () => path.join(dataDir(), "jif.json");
const casPath = () => path.join(dataDir(), "cas.json");

interface ScimagoFile { year?: number; updatedAt: string; source: string; count: number; byIssn: Record<string, unknown>; }
interface WarningFile { year?: number; updatedAt: string; source: string; entries: unknown[]; }
interface JifFile { year?: number; updatedAt: string; source: string; count: number; byIssn: Record<string, unknown>; }
interface CasFile { year?: number; updatedAt: string; source: string; count: number; byIssn: Record<string, unknown>; }

let scimagoCache: ScimagoDataset | null = null;
let scimagoMeta: { year?: number; updatedAt?: string; source?: string; count?: number } | null = null;
let warningCache: WarningDataset | null = null;
let warningMeta: { year?: number; updatedAt?: string; source?: string; count?: number } | null = null;
let jifCache: WosJifDataset | null = null;
let jifMeta: { year?: number; updatedAt?: string; source?: string; count?: number } | null = null;
let casCache: CasPartitionDataset | null = null;
let casMeta: { year?: number; updatedAt?: string; source?: string; count?: number } | null = null;
let loaded = false;

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as T; } catch { return null; }
}

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;
  const sf = readJson<ScimagoFile>(scimagoPath());
  if (sf && sf.byIssn) {
    scimagoCache = { year: sf.year, rows: [], byIssn: sf.byIssn as ScimagoDataset["byIssn"] };
    scimagoMeta = { year: sf.year, updatedAt: sf.updatedAt, source: sf.source, count: sf.count };
  }
  const wf = readJson<WarningFile>(warningPath());
  const userEntries = wf && Array.isArray(wf.entries) ? (wf.entries as WarningEntry[]) : [];
  rebuildWarning(userEntries, wf?.source, wf?.updatedAt);
  const jf = readJson<JifFile>(jifPath());
  if (jf && jf.byIssn) {
    jifCache = { year: jf.year, rows: [], byIssn: jf.byIssn as WosJifDataset["byIssn"] };
    jifMeta = { year: jf.year, updatedAt: jf.updatedAt, source: jf.source, count: jf.count };
  }
  const cf = readJson<CasFile>(casPath());
  if (cf && cf.byIssn) {
    casCache = { year: cf.year, rows: [], byIssn: cf.byIssn as CasPartitionDataset["byIssn"] };
    casMeta = { year: cf.year, updatedAt: cf.updatedAt, source: cf.source, count: cf.count };
  }
}

/**
 * 重建预警数据集：内置 2025 ∪ 用户导入（去重保留年度最新一条，见 parseWarningJson）。
 * 好处：来年导入新版后，旧年度自动降级为“历史”（黄标），无需手动清理；官方规则得以遵守。
 */
function rebuildWarning(userEntries: WarningEntry[], source?: string, updatedAt?: string): void {
  const merged = [...BUILTIN_WARNING_ENTRIES, ...(userEntries || [])];
  warningCache = parseWarningJson(merged);
  const hasUser = Array.isArray(userEntries) && userEntries.length > 0;
  warningMeta = {
    year: warningCache.maxYear ?? BUILTIN_WARNING_YEAR,
    updatedAt: hasUser ? updatedAt : undefined,
    source: hasUser ? (source || "手动导入") : BUILTIN_WARNING_SOURCE + "（内置）",
    count: warningCache.entries.length,
  };
}

function datasetInfos(): DatasetInfo[] {
  loadFromDisk();
  return [
    {
      id: "scimago",
      label: "SCImago 分区 (SJR)",
      present: !!scimagoCache,
      count: scimagoMeta?.count,
      year: scimagoMeta?.year,
      updatedAt: scimagoMeta?.updatedAt,
      source: scimagoMeta?.source || SCIMAGO_CSV_URL,
      sourceHomepage: SCIMAGO_HOMEPAGE,
    },
    {
      id: "warning",
      label: "国际期刊预警名单",
      present: !!(warningCache && warningCache.entries.length),
      count: warningMeta?.count ?? 0,
      year: warningMeta?.year,
      updatedAt: warningMeta?.updatedAt,
      source: warningMeta?.source || "手动导入（官方无机读接口）",
      sourceHomepage: WARNING_HOMEPAGE,
    },
    {
      id: "jif",
      label: "Journal Impact Factor (JIF)",
      present: !!jifCache,
      count: jifMeta?.count,
      year: jifMeta?.year,
      updatedAt: jifMeta?.updatedAt,
      source: jifMeta?.source || WOS_JIF_SOURCE,
      sourceHomepage: WOS_JIF_HOMEPAGE,
    },
    {
      id: "cas",
      label: "中科院期刊分区",
      present: !!casCache,
      count: casMeta?.count,
      year: casMeta?.year,
      updatedAt: casMeta?.updatedAt,
      source: casMeta?.source || LETPUB_SOURCE,
      sourceHomepage: LETPUB_HOMEPAGE,
    },
  ];
}

/** 经 Chromium session 拉取（带 cookie 预热，绕 SCImago 的 Cloudflare 机器人拦截） */
async function sessionFetch(url: string, init?: RequestInit): Promise<Response> {
  const ses = session.defaultSession;
  if (typeof ses.fetch === "function") return ses.fetch(url, init as any);
  return fetch(url, init);
}

function saveScimagoDataset(ds: ReturnType<typeof parseScimagoCsv>, source: string): DatasetInfo | undefined {
  const journalCount = ds.rows.length;
  const file: ScimagoFile = {
    year: ds.year,
    updatedAt: new Date().toISOString(),
    source,
    count: journalCount,
    byIssn: ds.byIssn,
  };
  fs.writeFileSync(scimagoPath(), JSON.stringify(file), "utf-8");
  scimagoCache = { year: ds.year, rows: [], byIssn: ds.byIssn };
  scimagoMeta = { year: ds.year, updatedAt: file.updatedAt, source: file.source, count: journalCount };
  return datasetInfos().find((d) => d.id === "scimago");
}

async function updateScimago(): Promise<{ ok: boolean; info?: DatasetInfo; error?: string }> {
  try {
    // 预热首页获取 Cloudflare cookie，再拉 CSV（否则常见 403）
    try { await sessionFetch(SCIMAGO_HOMEPAGE, { headers: { accept: "text/html,*/*" } }); } catch { /* 预热失败仍尝试 */ }
    const csv = await fetchScimagoCsv(sessionFetch as unknown as typeof fetch);
    const ds = parseScimagoCsv(csv);
    if (!ds.rows.length) return { ok: false, error: "empty_or_parse_failed" };
    const info = saveScimagoDataset(ds, SCIMAGO_CSV_URL);
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

function importScimagoFromText(text: string): { ok: boolean; info?: DatasetInfo; error?: string } {
  try {
    const ds = parseScimagoCsv(String(text || ""));
    if (!ds.rows.length) return { ok: false, error: "empty_or_parse_failed" };
    const info = saveScimagoDataset(ds, "手动导入（本地 CSV/XLS）");
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

function saveJifDataset(ds: WosJifDataset, source: string): DatasetInfo | undefined {
  const journalCount = ds.rows.length || Object.keys(ds.byIssn).length;
  const file: JifFile = {
    year: ds.year,
    updatedAt: new Date().toISOString(),
    source,
    count: journalCount,
    byIssn: ds.byIssn,
  };
  fs.writeFileSync(jifPath(), JSON.stringify(file), "utf-8");
  jifCache = { year: ds.year, rows: [], byIssn: ds.byIssn };
  jifMeta = { year: ds.year, updatedAt: file.updatedAt, source: file.source, count: journalCount };
  return datasetInfos().find((d) => d.id === "jif");
}

function importJifFromText(text: string): { ok: boolean; info?: DatasetInfo; error?: string } {
  try {
    const ds = parseWosJifTable(String(text || ""));
    if (!ds.rows.length) return { ok: false, error: "empty_or_parse_failed" };
    const info = saveJifDataset(ds, "手动导入（本地表格）");
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

async function updateJif(
  onProgress?: (p: { phase: string; page: number; rows: number; label: string }) => void,
): Promise<{ ok: boolean; info?: DatasetInfo; error?: string }> {
  try {
    try { await sessionFetch(WOS_JIF_HOMEPAGE, { headers: { accept: "text/html,*/*" } }); } catch { /* 预热失败仍尝试 */ }
    const ds = await crawlWosJifDataset(sessionFetch as unknown as typeof fetch, (p) => onProgress?.(p));
    if (!ds.rows.length) return { ok: false, error: "empty_or_parse_failed" };
    const info = saveJifDataset(ds, WOS_JIF_HOMEPAGE);
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

function saveCasDataset(ds: CasPartitionDataset, source: string): DatasetInfo | undefined {
  const journalCount = ds.rows.length || Object.keys(ds.byIssn).length;
  const file: CasFile = {
    year: ds.year,
    updatedAt: new Date().toISOString(),
    source,
    count: journalCount,
    byIssn: ds.byIssn,
  };
  fs.writeFileSync(casPath(), JSON.stringify(file), "utf-8");
  casCache = { year: ds.year, rows: [], byIssn: ds.byIssn };
  casMeta = { year: ds.year, updatedAt: file.updatedAt, source: file.source, count: journalCount };
  return datasetInfos().find((d) => d.id === "cas");
}

function importCasFromText(text: string): { ok: boolean; info?: DatasetInfo; error?: string } {
  try {
    const ds = parseCasPartitionTable(String(text || ""));
    if (!ds.rows.length) return { ok: false, error: "empty_or_parse_failed" };
    const info = saveCasDataset(ds, "手动导入（本地表格）");
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

async function updateCas(
  onProgress?: (p: { phase: string; page: number; rows: number; label: string }) => void,
): Promise<{ ok: boolean; info?: DatasetInfo; error?: string }> {
  try {
    try { await sessionFetch(LETPUB_HOMEPAGE, { headers: { accept: "text/html,*/*" } }); } catch { /* 预热失败仍尝试 */ }
    const ds = await crawlCasPartitionDataset(sessionFetch as unknown as typeof fetch, (p) => onProgress?.(p));
    if (!ds.rows.length) return { ok: false, error: "empty_or_parse_failed" };
    const info = saveCasDataset(ds, LETPUB_HOMEPAGE);
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}


async function updateWarningFromUrl(url: string): Promise<{ ok: boolean; info?: DatasetInfo; error?: string }> {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: "invalid_url" };
  try {
    const res = await fetch(u, { headers: { accept: "application/json,*/*" } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const raw = await res.json();
    return saveWarning(raw, u);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

function importWarningFromText(text: string): { ok: boolean; info?: DatasetInfo; error?: string } {
  try {
    const raw = JSON.parse(String(text || ""));
    return saveWarning(raw, "手动导入（本地文件/粘贴）");
  } catch (e) {
    return { ok: false, error: "json_parse_failed: " + String((e as Error)?.message || e) };
  }
}

function saveWarning(raw: unknown, source: string): { ok: boolean; info?: DatasetInfo; error?: string } {
  const parsed = parseWarningJson(raw);
  if (!parsed.entries.length) return { ok: false, error: "empty_or_invalid_format" };
  const updatedAt = new Date().toISOString();
  const file: WarningFile = { year: parsed.maxYear, updatedAt, source, entries: parsed.entries };
  try { fs.writeFileSync(warningPath(), JSON.stringify(file), "utf-8"); } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
  // 与内置 2025 合并后生效（含历史/当前分层）
  rebuildWarning(parsed.entries, source, updatedAt);
  return { ok: true, info: datasetInfos().find((d) => d.id === "warning") };
}

/** 构建 LLM 客户端（复用设置页配置；未配置时抛出可读错误） */
async function buildLlm(deps: IpcDeps) {
  const { store, secrets } = deps;
  const settings = await hydrateLlmSettings(store, async (k) => !!(await secrets.get(k)));
  const llm = settings.llm;
  const provider = llm?.provider;
  if (!provider) throw new Error("请先在「设置 → 大模型」选择提供方并填写模型。");
  const model = String(llm?.model || "").trim() || PROVIDER_DEFAULT_MODEL[provider] || "";
  if (!model) throw new Error("请先在「设置 → 大模型」填写模型。");
  if (provider !== "ollama" && !(await secrets.get(`${provider}_key`))) {
    throw new Error("请先在「设置 → 大模型」保存 API Key。");
  }
  return llmFromConfig({ ...llm!, provider, model }, () => secrets.get(`${provider}_key`));
}

export function registerJournalIpc(deps: IpcDeps): void {
  ipcMain.handle("journal:search", async (_e, query: string) => {
    loadFromDisk();
    try {
      return await lookupJournal(query, {
        fetchImpl: fetch,
        scimago: scimagoCache,
        warning: warningCache || EMPTY_WARNING_DATASET,
        jif: jifCache,
        cas: casCache,
      });
    } catch (e) {
      return { ok: false, query, warning: null, provenance: {}, error: String((e as Error)?.message || e) };
    }
  });
  ipcMain.handle("journal:datasets", () => datasetInfos());
  ipcMain.handle("journal:updateScimago", () => updateScimago());
  ipcMain.handle("journal:importScimago", (_e, text: string) => importScimagoFromText(text));
  ipcMain.handle("journal:updateJif", async (e) => updateJif((p) => {
    try { e.sender.send("journal:jifProgress", p); } catch { /* 渲染层已关 */ }
  }));
  ipcMain.handle("journal:importJif", (_e, text: string) => importJifFromText(text));
  ipcMain.handle("journal:updateCas", async (e) => updateCas((p) => {
    try { e.sender.send("journal:casProgress", p); } catch { /* 渲染层已关 */ }
  }));
  ipcMain.handle("journal:importCas", (_e, text: string) => importCasFromText(text));
  ipcMain.handle("journal:updateWarningUrl", (_e, url: string) => updateWarningFromUrl(url));
  ipcMain.handle("journal:importWarning", (_e, text: string) => importWarningFromText(text));
  // 粘贴官方文本 → AI 结构化（仅排版，不臆造）→ 返回条目供预览（不落盘）
  ipcMain.handle("journal:structureWarningText", async (_e, text: string) => {
    const raw = String(text || "").trim();
    if (!raw) return { ok: false, error: "empty_input" };
    try {
      const llm = await buildLlm(deps);
      const entries = await structureWarningEntries(raw, llm);
      if (!entries.length) return { ok: false, error: "no_entries_parsed" };
      return { ok: true, entries };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  });
}
