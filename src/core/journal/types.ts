// lumina-feed · 期刊信息工具 · 类型
// 定位：期刊尽职调查 / 避坑工具（非「影响因子查询器」）。每字段带来源+年份，缺失显式为空。

/** 单个字段的来源标注（可溯源） */
export interface FieldProvenance {
  source: string;      // 如 "OpenAlex" / "SCImago 2023" / "CAS 预警 2025"
  year?: number;       // 数据年度（数据集类字段）
  note?: string;
}

/** SCImago 分区（按学科的最佳分位 + 各学科分位） */
export interface ScimagoQuartile {
  sjr?: number;                 // SJR 指标值
  bestQuartile?: string;        // Q1 / Q2 / Q3 / Q4
  rank?: number;                // 全表排名
  hIndex?: number;
  country?: string;
  categories?: Array<{ name: string; quartile: string }>;
  year?: number;
}

/** CAS 国际期刊预警条目 */
export interface WarningEntry {
  title: string;
  issn?: string;
  level?: string;               // 预警等级（高/中/低）若名单提供
  year?: number;
  reason?: string;
}

/** 期刊完整画像（合并 live + 数据集） */
export interface JournalProfile {
  ok: boolean;
  query: string;
  // 基础身份
  name?: string;
  publisher?: string;
  homepage?: string;
  issnL?: string;
  issns?: string[];
  // OpenAlex live 指标
  impact2yr?: number;           // 2yr mean citedness（类影响因子，非 JIF）
  hIndex?: number;
  worksCount?: number;
  citedByCount?: number;
  isOa?: boolean;
  isInDoaj?: boolean;
  // 数据集字段
  scimago?: ScimagoQuartile;
  warning?: WarningEntry | null;
  warningHistorical?: boolean;  // 命中的是历史年度名单（官方：整改后移出，不等于当前预警）
  // 溯源
  provenance: Record<string, FieldProvenance>;
  // 候选（名称检索命中多个时）
  candidates?: Array<{ id: string; name: string; issnL?: string; publisher?: string }>;
  error?: string;
}

/** 数据集缓存状态（供 UI 展示「来源 / 更新时间 / 年度」） */
export interface DatasetInfo {
  id: string;                   // "scimago" | "warning"
  label: string;
  present: boolean;
  count?: number;
  year?: number;
  updatedAt?: string;           // ISO
  source?: string;              // 来源 URL / 说明
  sourceHomepage?: string;      // 官方页（供「查看官方页」）
}
