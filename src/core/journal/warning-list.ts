// lumina-feed · 国际期刊预警名单（中科院文献情报中心 · 公开发布）
// 诚实原则：不内置未经核对的期刊名（误标会造成名誉损害）。
// 默认空 → 用户从官方来源手动导入/更新；官方页见 WARNING_HOMEPAGE。
import type { WarningEntry } from "./types.ts";
import { normalizeIssn } from "./issn.ts";
import { CAS_WARNING_2025, CAS_WARNING_YEAR, CAS_WARNING_SOURCE } from "./cas-warning-2025.ts";

export const WARNING_HOMEPAGE = "https://ewl.fenqubiao.com/";

export interface WarningDataset {
  year?: number;        // = maxYear（当前有效年度）
  maxYear?: number;     // 数据集中最新年度；用于判定“当前 vs 历史”
  entries: WarningEntry[];
  byIssn: Record<string, WarningEntry>;
  byTitle: Record<string, WarningEntry>;  // 归一化小写标题 → 条目
}

function normTitle(s?: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
}

/**
 * 解析预警名单 JSON（[{title,issn,level,year,reason}]）。
 * 支持多年度合并：同一刊（按 ISSN，否则刊名）去重，保留年度最新的一条；
 * maxYear 记录最新年度，供 isHistoricalWarning 判定“已移出当前名单”。
 */
export function parseWarningJson(raw: unknown): WarningDataset {
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object" && Array.isArray((raw as any).entries)) arr = (raw as any).entries;

  // 去重：key = 紧凑 ISSN（有则用）否则归一化刊名；同 key 保留 year 最大者（相等则后者覆盖）
  const map = new Map<string, WarningEntry>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const title = String(it.title || it.journal || "").trim();
    if (!title) continue;
    const e: WarningEntry = {
      title,
      issn: normalizeIssn(it.issn) || undefined,
      level: it.level ? String(it.level) : undefined,
      year: typeof it.year === "number" ? it.year : undefined,
      reason: it.reason ? String(it.reason) : undefined,
    };
    const key = e.issn ? e.issn.replace("-", "") : "t:" + normTitle(title);
    const prev = map.get(key);
    if (!prev || (e.year || 0) >= (prev.year || 0)) map.set(key, e);
  }

  const entries = [...map.values()];
  const byIssn: Record<string, WarningEntry> = {};
  const byTitle: Record<string, WarningEntry> = {};
  let maxYear: number | undefined;
  for (const e of entries) {
    if (e.year != null) maxYear = maxYear == null ? e.year : Math.max(maxYear, e.year);
    if (e.issn) byIssn[e.issn.replace("-", "")] = e;
    byTitle[normTitle(e.title)] = e;
  }
  return { year: maxYear, maxYear, entries, byIssn, byTitle };
}

/** 按 ISSN 或刊名查预警（命中即返回去重后年度最新的一条） */
export function warningLookup(
  ds: WarningDataset | null | undefined,
  issns: string[],
  name?: string,
): WarningEntry | null {
  if (!ds || !ds.entries.length) return null;
  for (const raw of issns) {
    const n = normalizeIssn(raw);
    if (n && ds.byIssn[n.replace("-", "")]) return ds.byIssn[n.replace("-", "")];
  }
  const t = normTitle(name);
  if (t && ds.byTitle[t]) return ds.byTitle[t];
  return null;
}

/**
 * 该命中是否为“历史年度”预警：条目年度 < 数据集最新年度。
 * 官方规则：经整改移出下年度名单后不再是预警期刊，故历史命中只作黄色提示、不等于当前预警。
 */
export function isHistoricalWarning(
  ds: WarningDataset | null | undefined,
  entry: WarningEntry | null | undefined,
): boolean {
  if (!ds || !entry || entry.year == null || ds.maxYear == null) return false;
  return entry.year < ds.maxYear;
}

/** 内置默认数据集（空）——避免误标 */
export const EMPTY_WARNING_DATASET: WarningDataset = { entries: [], byIssn: {}, byTitle: {} };

export const BUILTIN_WARNING_YEAR = CAS_WARNING_YEAR;
export const BUILTIN_WARNING_SOURCE = CAS_WARNING_SOURCE;
/** 内置原始条目（供与用户导入合并；含 year 字段以支持“当前 vs 历史”判定） */
export const BUILTIN_WARNING_ENTRIES: WarningEntry[] = CAS_WARNING_2025;

/** 内置默认数据集：中科院 2025 预警名单（经多来源核对，开箱即用；可被用户导入覆盖） */
export function builtinWarningDataset(): WarningDataset {
  return parseWarningJson(CAS_WARNING_2025);
}
