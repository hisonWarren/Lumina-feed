// lumina-feed · 国际期刊预警名单（中科院文献情报中心 · 公开发布）
// 诚实原则：不内置未经核对的期刊名（误标会造成名誉损害）。
// 默认空 → 用户从官方来源手动导入/更新；官方页见 WARNING_HOMEPAGE。
import type { WarningEntry } from "./types.ts";
import { normalizeIssn } from "./issn.ts";
import { CAS_WARNING_2025, CAS_WARNING_YEAR, CAS_WARNING_SOURCE } from "./cas-warning-2025.ts";

export const WARNING_HOMEPAGE = "https://ewl.fenqubiao.com/";

export interface WarningDataset {
  year?: number;
  entries: WarningEntry[];
  byIssn: Record<string, WarningEntry>;
  byTitle: Record<string, WarningEntry>;  // 归一化小写标题 → 条目
}

function normTitle(s?: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
}

/** 解析预警名单 JSON（[{title,issn,level,year,reason}]） */
export function parseWarningJson(raw: unknown): WarningDataset {
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object" && Array.isArray((raw as any).entries)) arr = (raw as any).entries;
  const entries: WarningEntry[] = [];
  const byIssn: Record<string, WarningEntry> = {};
  const byTitle: Record<string, WarningEntry> = {};
  let year: number | undefined;
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
    if (e.year && !year) year = e.year;
    entries.push(e);
    if (e.issn) byIssn[e.issn.replace("-", "")] = e;
    byTitle[normTitle(title)] = e;
  }
  return { year, entries, byIssn, byTitle };
}

/** 按 ISSN 或刊名查预警 */
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

/** 内置默认数据集（空）——避免误标 */
export const EMPTY_WARNING_DATASET: WarningDataset = { entries: [], byIssn: {}, byTitle: {} };

export const BUILTIN_WARNING_YEAR = CAS_WARNING_YEAR;
export const BUILTIN_WARNING_SOURCE = CAS_WARNING_SOURCE;

/** 内置默认数据集：中科院 2025 预警名单（经多来源核对，开箱即用；可被用户导入覆盖） */
export function builtinWarningDataset(): WarningDataset {
  return parseWarningJson(CAS_WARNING_2025);
}
