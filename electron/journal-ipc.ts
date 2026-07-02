// lumina-feed · 期刊信息工具 IPC（live 查询 + 手动更新数据集）
// 数据策略：OpenAlex/DOAJ 每次 live 查询；SCImago 分区、预警名单为「在线拉取 + 手动更新」磁盘缓存。
import { ipcMain, app, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DatasetInfo } from "../src/core/journal/types.ts";
import { lookupJournal } from "../src/core/journal/lookup.ts";
import {
  parseScimagoCsv, fetchScimagoCsv, SCIMAGO_CSV_URL, SCIMAGO_HOMEPAGE, type ScimagoDataset,
} from "../src/core/journal/scimago.ts";
import {
  parseWarningJson, WARNING_HOMEPAGE, EMPTY_WARNING_DATASET, builtinWarningDataset,
  BUILTIN_WARNING_YEAR, BUILTIN_WARNING_SOURCE, type WarningDataset,
} from "../src/core/journal/warning-list.ts";

function dataDir(): string {
  const d = path.join(app.getPath("userData"), "journal-data");
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  return d;
}
const scimagoPath = () => path.join(dataDir(), "scimago.json");
const warningPath = () => path.join(dataDir(), "warning.json");

interface ScimagoFile { year?: number; updatedAt: string; source: string; count: number; byIssn: Record<string, unknown>; }
interface WarningFile { year?: number; updatedAt: string; source: string; entries: unknown[]; }

let scimagoCache: ScimagoDataset | null = null;
let scimagoMeta: { year?: number; updatedAt?: string; source?: string; count?: number } | null = null;
let warningCache: WarningDataset | null = null;
let warningMeta: { year?: number; updatedAt?: string; source?: string; count?: number } | null = null;
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
  if (wf && Array.isArray(wf.entries) && wf.entries.length) {
    // 用户导入的名单优先（覆盖内置）
    warningCache = parseWarningJson(wf.entries);
    warningMeta = { year: wf.year, updatedAt: wf.updatedAt, source: wf.source, count: warningCache.entries.length };
  } else {
    // 内置中科院 2025 名单（开箱即用）
    warningCache = builtinWarningDataset();
    warningMeta = { year: BUILTIN_WARNING_YEAR, updatedAt: undefined, source: BUILTIN_WARNING_SOURCE + "（内置）", count: warningCache.entries.length };
  }
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
  const ds = parseWarningJson(raw);
  if (!ds.entries.length) return { ok: false, error: "empty_or_invalid_format" };
  const file: WarningFile = {
    year: ds.year,
    updatedAt: new Date().toISOString(),
    source,
    entries: ds.entries,
  };
  try { fs.writeFileSync(warningPath(), JSON.stringify(file), "utf-8"); } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
  warningCache = ds;
  warningMeta = { year: ds.year, updatedAt: file.updatedAt, source, count: ds.entries.length };
  return { ok: true, info: datasetInfos().find((d) => d.id === "warning") };
}

export function registerJournalIpc(): void {
  ipcMain.handle("journal:search", async (_e, query: string) => {
    loadFromDisk();
    try {
      return await lookupJournal(query, {
        fetchImpl: fetch,
        scimago: scimagoCache,
        warning: warningCache || EMPTY_WARNING_DATASET,
      });
    } catch (e) {
      return { ok: false, query, warning: null, provenance: {}, error: String((e as Error)?.message || e) };
    }
  });
  ipcMain.handle("journal:datasets", () => datasetInfos());
  ipcMain.handle("journal:updateScimago", () => updateScimago());
  ipcMain.handle("journal:importScimago", (_e, text: string) => importScimagoFromText(text));
  ipcMain.handle("journal:updateWarningUrl", (_e, url: string) => updateWarningFromUrl(url));
  ipcMain.handle("journal:importWarning", (_e, text: string) => importWarningFromText(text));
}
