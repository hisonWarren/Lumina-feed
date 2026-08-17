// lumina-feed · 期刊信息工具 IPC（live 查询 + 手动更新数据集）
// 数据策略：OpenAlex/DOAJ 每次 live 查询；SCImago 分区、预警名单为「在线拉取 + 手动更新」磁盘缓存。
import { ipcMain, app } from "electron";
import { sessionFetchSafe } from "./safe-fetch.ts";
import { createOriginBrowserFetch, type OriginBrowserFetch } from "./origin-browser-fetch.ts";
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
  parseWosJifTable, crawlWosJifDataset, wosJifLookup, buildWosJifDataset, fetchWosJifByIssn,
  WOS_JIF_HOMEPAGE, WOS_JIF_SOURCE, type WosJifDataset, type WosJifRow,
} from "../src/core/journal/wos-jif.ts";
import { fetchLetPubImpactByIssn, LETPUB_IF_SOURCE } from "../src/core/journal/letpub-impact.ts";
import {
  parseCasPartitionTable, crawlCasPartitionDataset, casPartitionLookup, buildCasPartitionDataset, fetchCasPartitionByIssn,
  LETPUB_HOMEPAGE, LETPUB_SOURCE, type CasPartitionDataset, type CasPartitionRow,
} from "../src/core/journal/cas-partition.ts";
import type { WosJifInfo, CasPartitionInfo } from "../src/core/journal/types.ts";
import { structureWarningEntries } from "../src/core/journal/warning-structure.ts";
import { fetchSourceByIssn } from "../src/core/journal/openalex-source.ts";
import { raceFirstValid } from "../src/core/net/race-first.ts";
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
// 逐刊按需在线获取的落盘缓存（与「全量数据集」分离，不污染数据集计数/年度语义）
const jifLivePath = () => path.join(dataDir(), "jif-live.json");
const casLivePath = () => path.join(dataDir(), "cas-live.json");

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
// 逐刊按需缓存（issn → row），随查随存，二次查询瞬时命中
let liveJifByIssn: Record<string, WosJifRow> = {};
let liveCasByIssn: Record<string, CasPartitionRow> = {};
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
  liveJifByIssn = readJson<Record<string, WosJifRow>>(jifLivePath()) || {};
  liveCasByIssn = readJson<Record<string, CasPartitionRow>>(casLivePath()) || {};
}

/** 合并「全量数据集 + 逐刊缓存」用于查询（逐刊命中优先补充空缺） */
function mergedJifDataset(): WosJifDataset | null {
  const hasLive = Object.keys(liveJifByIssn).length > 0;
  if (!jifCache && !hasLive) return null;
  return { year: jifCache?.year, rows: [], byIssn: { ...(jifCache?.byIssn || {}), ...liveJifByIssn } };
}
function mergedCasDataset(): CasPartitionDataset | null {
  const hasLive = Object.keys(liveCasByIssn).length > 0;
  if (!casCache && !hasLive) return null;
  return { year: casCache?.year, rows: [], byIssn: { ...(casCache?.byIssn || {}), ...liveCasByIssn } };
}

function jifRowToInfo(row: WosJifRow): WosJifInfo {
  const fromLetPub = row.source === LETPUB_IF_SOURCE;
  return {
    jif: row.jif,
    jif5yr: row.jif5yr,
    wosIndexes: row.wosIndexes,
    abbreviation: row.abbreviation,
    category: row.category,
    country: row.country,
    publisher: row.publisher,
    oaSupport: row.oaSupport,
    wosStatus: row.wosStatus,
    bestRanking: row.bestRanking,
    year: row.year ?? jifCache?.year,
    wosId: row.wosId,
    source: row.source || WOS_JIF_SOURCE,
    sourceHomepage: fromLetPub
      ? (row.sourceHomepage || LETPUB_HOMEPAGE)
      : (row.wosId ? `${WOS_JIF_HOMEPAGE}journalid/${row.wosId}` : WOS_JIF_HOMEPAGE),
  };
}
function casRowToInfo(row: CasPartitionRow): CasPartitionInfo {
  return {
    majorZone: row.majorZone,
    majorCategory: row.majorCategory,
    minorCategories: row.minorCategories,
    isTop: row.isTop,
    year: row.year ?? casCache?.year,
    sourceHomepage: row.letpubId
      ? `${LETPUB_HOMEPAGE}&view=detail&journalid=${row.letpubId}`
      : LETPUB_HOMEPAGE,
  };
}

export type LiveOpenAlexPatch = {
  impact2yr?: number;
  hIndex?: number;
  worksCount?: number;
  citedByCount?: number;
  isOa?: boolean;
  isInDoaj?: boolean;
};

export type LiveMetricsResult = {
  jif?: WosJifInfo;
  cas?: CasPartitionInfo;
  openalex?: LiveOpenAlexPatch;
  jifTried?: boolean;
  casTried?: boolean;
  oaTried?: boolean;
};

/** 将 LetPub 行写入逐刊缓存并返回。 */
function cacheLetPubJif(lp: NonNullable<Awaited<ReturnType<typeof fetchLetPubImpactByIssn>>>, list: string[]): WosJifInfo {
  const row: WosJifRow = {
    title: lp.title,
    issns: lp.issns.length ? lp.issns : list.map((s) => String(s)).filter(Boolean),
    jif: lp.jif,
    jif5yr: lp.jif5yr,
    year: lp.year,
    source: LETPUB_IF_SOURCE,
    sourceHomepage: lp.sourceHomepage,
  };
  Object.assign(liveJifByIssn, buildWosJifDataset([row]).byIssn);
  try { fs.writeFileSync(jifLivePath(), JSON.stringify(liveJifByIssn), "utf-8"); } catch { /* ignore */ }
  return jifRowToInfo(row);
}

/** 竞速 LetPub ISSN → IF（国内直连）。 */
async function tryLetPubJif(list: string[], timeoutMs: number) {
  return raceFirstValid(
    list.slice(0, 2).map(
      (issn) => (signal: AbortSignal) =>
        fetchLetPubImpactByIssn(issn, sessionFetch as unknown as typeof fetch, signal),
    ),
    (r) => !!(r && (r.jif != null || r.jif5yr != null)),
    { timeoutMs },
  );
}

/** JIF-like 槽：本地命中优先 → LetPub（国内直连）→ wos-journal.info（可能需翻墙/CF）。 */
async function liveJifSlot(list: string[]): Promise<{ jif?: WosJifInfo; jifTried?: boolean }> {
  const jifHit = wosJifLookup(mergedJifDataset(), list);
  if (jifHit && (jifHit.jif != null || jifHit.jif5yr != null)) {
    // 已是 LetPub，或字段齐全：直接返回，不阻塞在 WOS Cloudflare。
    if (jifHit.source === LETPUB_IF_SOURCE || (jifHit.jif5yr != null && jifHit.source)) {
      return { jif: jifRowToInfo(jifHit) };
    }
    // 旧 WOS 缓存缺五年 IF / 未标来源：先用 LetPub 升级（国内可直连），失败再用本地值。
    try {
      const lp = await tryLetPubJif(list, 14000);
      if (lp) return { jif: cacheLetPubJif(lp, list), jifTried: true };
    } catch { /* 仍返回本地 */ }
    return { jif: jifRowToInfo(jifHit) };
  }

  // 1) LetPub 优先：无需翻墙、无 Cloudflare；公开页有 IF 历史图末值 / 五年 IF。
  try {
    const lp = await tryLetPubJif(list, 18000);
    if (lp) return { jif: cacheLetPubJif(lp, list), jifTried: true };
  } catch { /* LetPub 失败则回退 WOS */ }

  // 2) wos-journal.info 回退（CF / 网络可能失败）
  const row = await raceFirstValid(
    list.slice(0, 2).map(
      (issn) => (signal: AbortSignal) => fetchWosJifByIssn(issn, getWosBrowserFetch().fetch, signal),
    ),
    (r) => !!(r && (r.jif != null || r.jif5yr != null)),
    { timeoutMs: 45000 },
  );
  if (row) {
    Object.assign(liveJifByIssn, buildWosJifDataset([row]).byIssn);
    try { fs.writeFileSync(jifLivePath(), JSON.stringify(liveJifByIssn), "utf-8"); } catch { /* ignore */ }
    return { jif: jifRowToInfo(row), jifTried: true };
  }
  resetWosBrowserFetch();
  return { jifTried: true };
}

/** 中科院槽：本地命中优先；否则 ISSN 竞速。 */
async function liveCasSlot(list: string[]): Promise<{ cas?: CasPartitionInfo; casTried?: boolean }> {
  const casHit = casPartitionLookup(mergedCasDataset(), list);
  if (casHit && casHit.majorZone) return { cas: casRowToInfo(casHit) };

  const row = await raceFirstValid(
    list.slice(0, 2).map(
      (issn) => (signal: AbortSignal) =>
        fetchCasPartitionByIssn(issn, sessionFetch as unknown as typeof fetch, signal),
    ),
    (r) => !!(r && r.majorZone),
    { timeoutMs: 20000 },
  );
  if (row) {
    Object.assign(liveCasByIssn, buildCasPartitionDataset([row]).byIssn);
    try { fs.writeFileSync(casLivePath(), JSON.stringify(liveCasByIssn), "utf-8"); } catch { /* ignore */ }
    return { cas: casRowToInfo(row), casTried: true };
  }
  return { casTried: true };
}

/** OpenAlex 类影响因子槽（与 JIF 分槽，互不抢标签）。 */
async function liveOpenAlexSlot(list: string[]): Promise<{ openalex?: LiveOpenAlexPatch; oaTried?: boolean }> {
  const src = await raceFirstValid(
    list.slice(0, 2).map(
      (issn) => (signal: AbortSignal) =>
        fetchSourceByIssn(issn, { fetchImpl: sessionFetch as unknown as typeof fetch, signal }),
    ),
    (r) => !!(r && (r.impact2yr != null || r.hIndex != null)),
    { timeoutMs: 12000 },
  );
  if (!src) return { oaTried: true };
  return {
    oaTried: true,
    openalex: {
      impact2yr: src.impact2yr,
      hIndex: src.hIndex,
      worksCount: src.worksCount,
      citedByCount: src.citedByCount,
      isOa: src.isOa,
      isInDoaj: src.isInDoaj,
    },
  };
}

/**
 * 分槽并行补齐：OpenAlex 类影响因子 ∥ JIF-like ∥ 中科院分区。
 * 各槽独立；槽内多 ISSN 竞速，先校验通过者胜出并 abort 其余。不把 OpenAlex 标成 JIF。
 * opts 控制开哪些槽（默认全开，兼容旧调用）。
 */
async function liveMetrics(
  issns: string[],
  opts?: { jif?: boolean; cas?: boolean; openalex?: boolean },
): Promise<LiveMetricsResult> {
  loadFromDisk();
  const list = (issns || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (!list.length) return {};

  const wantJif = opts?.jif !== false;
  const wantCas = opts?.cas !== false;
  const wantOa = opts?.openalex !== false;

  const [oa, jifPart, casPart] = await Promise.all([
    wantOa ? liveOpenAlexSlot(list) : Promise.resolve({} as { openalex?: LiveOpenAlexPatch; oaTried?: boolean }),
    wantJif ? liveJifSlot(list) : Promise.resolve({} as { jif?: WosJifInfo; jifTried?: boolean }),
    wantCas ? liveCasSlot(list) : Promise.resolve({} as { cas?: CasPartitionInfo; casTried?: boolean }),
  ]);
  return { ...oa, ...jifPart, ...casPart };
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
  return sessionFetchSafe(url, init);
}

/** wos-journal.info：session.fetch 仍会被 CF 403；隐藏窗 + 页内 fetch 可过 Turnstile */
let wosBrowserFetch: OriginBrowserFetch | null = null;
function getWosBrowserFetch(): OriginBrowserFetch {
  if (!wosBrowserFetch) {
    wosBrowserFetch = createOriginBrowserFetch(WOS_JIF_HOMEPAGE, {
      readyExpr:
        `!/just a moment/i.test(document.title) && /Journal Impact Factor/i.test(document.body ? document.body.innerText : "")`,
      warmTimeoutMs: 90_000,
      loadTimeoutMs: 25_000,
      showAfterMs: 8_000,
    });
  }
  return wosBrowserFetch;
}

function resetWosBrowserFetch(): void {
  try { wosBrowserFetch?.reset(); } catch { /* ignore */ }
  // Keep instance (reset clears queue); recreate only if fully closed
  if (!wosBrowserFetch) return;
}

function jifOnlineError(err: unknown): string {
  const msg = String((err as Error)?.message || err);
  if (/aborted/i.test(msg)) {
    return "已取消或超时。可稍后重试；若反复卡住，请改用「导入」CSV。";
  }
  if (/timeout|Cloudflare|challenge|403/i.test(msg)) {
    return "wos-journal.info 人机验证未通过或超时。若弹出验证窗口请勾选完成；仍失败请改用「导入」CSV。";
  }
  return msg;
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
  const browser = getWosBrowserFetch();
  try {
    await browser.warm((label) => onProgress?.({ phase: "crawl", page: 0, rows: 0, label }));
    const ds = await crawlWosJifDataset(browser.fetch, (p) => onProgress?.(p), { pageDelayMs: 80 });
    if (!ds.rows.length) return { ok: false, error: "empty_or_parse_failed" };
    const info = saveJifDataset(ds, WOS_JIF_HOMEPAGE);
    return { ok: true, info };
  } catch (e) {
    resetWosBrowserFetch();
    return { ok: false, error: jifOnlineError(e) };
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
        jif: mergedJifDataset(),
        cas: mergedCasDataset(),
      });
    } catch (e) {
      return { ok: false, query, warning: null, provenance: {}, error: String((e as Error)?.message || e) };
    }
  });
  ipcMain.handle("journal:datasets", () => datasetInfos());
  ipcMain.handle("journal:liveMetrics", (_e, issns: string[], opts?: { jif?: boolean; cas?: boolean; openalex?: boolean }) =>
    liveMetrics(issns, opts));
  ipcMain.handle("journal:updateScimago", () => updateScimago());
  ipcMain.handle("journal:importScimago", (_e, text: string) => importScimagoFromText(text));
  ipcMain.handle("journal:updateJif", async (e) => updateJif((p) => {
    try { e.sender.send("journal:jifProgress", p); } catch { /* 渲染层已关 */ }
  }));
  ipcMain.handle("journal:cancelJif", () => {
    resetWosBrowserFetch();
    return { ok: true };
  });
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
