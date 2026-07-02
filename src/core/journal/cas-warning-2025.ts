// lumina-feed · 内置：中科院文献情报中心《国际期刊预警名单》2025 版
// 发布：2025-03-19 期刊分区表团队。官方门户：https://ewl.fenqubiao.com/#/zh-cn/early-warning-journal-list-2025
// 数据经多来源交叉核对（官方 iae.cas.cn / ewl.fenqubiao.com + 多所高校科研处转载）。
// 官方规则：不同年度名单不可合并使用；整改达标的期刊会被移出。仅内置当年（2025）名单。
import type { WarningEntry } from "./types.ts";

export const CAS_WARNING_YEAR = 2025;
export const CAS_WARNING_SOURCE = "中国科学院文献情报中心 · 国际期刊预警名单 2025";

export const CAS_WARNING_2025: WarningEntry[] = [
  { title: "Wireless Personal Communications", issn: "0929-6212", reason: "论文工厂", year: 2025 },
  { title: "Natural Resources Forum", issn: "0165-0203", reason: "论文工厂", year: 2025 },
  { title: "Computers & Electrical Engineering", issn: "0045-7906", reason: "论文工厂", year: 2025 },
  { title: "Numerical Heat Transfer Part A-Applications", issn: "1040-7782", reason: "论文工厂", year: 2025 },
  { title: "Scalable Computing-Practice and Experience", issn: "1895-1767", reason: "论文工厂", year: 2025 },
];
