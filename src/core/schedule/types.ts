// lumina-feed · 调度与推送 · 类型
// 纯类型，跨 Electron 主进程 / 自托管 worker 共享。

export type Frequency = "daily" | "weekly" | "hourly";

export interface Schedule {
  freq: Frequency;
  /** 本地墙钟时间 "HH:MM"（daily/weekly 用），相对 tz */
  time: string;
  /** IANA 时区，如 "Asia/Shanghai" */
  tz: string;
  /** weekly 用：0=周日 … 6=周六 */
  weekday?: number;
  /** 安静时段 [startHour, endHour)（tz 本地小时，可跨夜，如 [22, 8]）；该时段内到点不打扰，结束后补发 */
  quietHours?: [number, number] | null;
  /** hourly 用：每多少分钟一次（缺省 60） */
  everyMinutes?: number;
}

/** 订阅 = 一个主题/检索式 + 调度 + 总结选项（query/summarize 在本层视为不透明，由 M1/M4 解释） */
export interface Subscription {
  id: string;
  name: string;
  query: unknown;
  summarize?: unknown;
  schedule: Schedule;
  enabled: boolean;
  /** 上次成功跑完的 ISO 时间（含「无新命中」也推进，避免重复） */
  lastRunAt?: string | null;
  /** 去重记忆：已推送过的文献 id（按时间截断，避免无限增长） */
  seenIds?: string[];
}

export interface DigestItem {
  id: string;
  title: string;
  authors?: string[];
  journal?: string;
  year?: number;
  url?: string;
  doi?: string;
  isPreprint?: boolean;
  type?: string;
  /** AI 一句话总结（可空） */
  tldr?: string;
  /** 总结依据：基于全文 / 基于摘要（反幻觉标识） */
  sourceBasis?: "fulltext" | "abstract" | null;
}

export interface Digest {
  subscriptionId: string;
  subscriptionName: string;
  /** 该简报对应日期（ISO date） */
  date: string;
  items: DigestItem[];
  stats?: Record<string, number>;
  generatedAt: string;
}

export type SkipReason = "disabled" | "not_due" | "quiet_hours" | "no_new" | null;

export interface RunResult {
  subscriptionId: string;
  ranAt: string;
  newCount: number;
  digest?: Digest | null;
  skipped?: SkipReason;
  error?: string | null;
}

/** 可注入时钟，便于测试 */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

/** 日志钩子 */
export type Logger = (level: "info" | "warn" | "error", msg: string, extra?: unknown) => void;
export const consoleLogger: Logger = (lvl, msg, extra) =>
  console[lvl === "error" ? "error" : lvl === "warn" ? "warn" : "log"](`[lumina:${lvl}] ${msg}`, extra ?? "");
