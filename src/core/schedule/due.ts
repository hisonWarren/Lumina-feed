// lumina-feed · 调度判定（纯函数，无副作用，可单测）
// 关键工程真相：node-cron 只在进程存活时触发，且不补漏跑。
// 这里用「最近一次应跑实例 vs lastRun」的方式判定 due —— 天然支持
// 「机器关机/休眠错过的那次，开机后立刻补发一次」（catch-up）。
import type { Schedule } from "./types.ts";

interface TzParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number; }

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 把某个 UTC 瞬间，格式化成它在 tz 下的墙钟分量 */
export function partsInTz(date: Date, tz: string): TzParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0; // 某些环境 midnight 显示 24
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour, minute: +p.minute, second: +p.second,
    weekday: WD[p.weekday] ?? 0,
  };
}

/** tz 相对 UTC 的偏移（毫秒），在给定瞬间处取值（含 DST） */
function tzOffsetMs(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/** 把「tz 下的墙钟时间 y-m-d H:M」转成真实 UTC 瞬间。
 *  DST 切换的那一小时为近似（对通知调度足够）。 */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const naiveUTC = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = tzOffsetMs(new Date(naiveUTC), tz);
  return new Date(naiveUTC - offset);
}

function parseHM(time: string): [number, number] {
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  return [h || 0, m || 0];
}

/** 安静时段判定：quiet=[start,end) 为 tz 本地小时，支持跨夜（如 [22,8]） */
export function withinQuietHours(date: Date, tz: string, quiet?: [number, number] | null): boolean {
  if (!quiet) return false;
  const [s, e] = quiet;
  if (s === e) return false;
  const { hour } = partsInTz(date, tz);
  return s < e ? hour >= s && hour < e : hour >= s || hour < e; // 跨夜
}

/** 最近一次「应当触发」的实例（<= now）。lastRun < 该实例 ⇒ 该跑（含补漏跑）。 */
export function lastScheduledInstant(schedule: Schedule, now: Date): Date {
  const tz = schedule.tz;
  if (schedule.freq === "hourly") {
    const step = (schedule.everyMinutes ?? 60) * 60_000;
    return new Date(Math.floor(now.getTime() / step) * step);
  }
  const [hh, mm] = parseHM(schedule.time);
  const p = partsInTz(now, tz);

  if (schedule.freq === "daily") {
    // 今天的 hh:mm（tz）；若还没到，则取昨天的
    let inst = zonedTimeToUtc(p.year, p.month, p.day, hh, mm, tz);
    if (inst.getTime() > now.getTime()) inst = new Date(inst.getTime() - 86_400_000);
    return inst;
  }

  // weekly：找最近一次 weekday@hh:mm（<= now），最多回看 7 天
  const targetWd = schedule.weekday ?? 0;
  for (let back = 0; back < 8; back++) {
    const cand = new Date(now.getTime() - back * 86_400_000);
    const cp = partsInTz(cand, tz);
    if (cp.weekday === targetWd) {
      const inst = zonedTimeToUtc(cp.year, cp.month, cp.day, hh, mm, tz);
      if (inst.getTime() <= now.getTime()) return inst;
    }
  }
  // 兜底：上周同日
  const cp = partsInTz(new Date(now.getTime() - 7 * 86_400_000), tz);
  return zonedTimeToUtc(cp.year, cp.month, cp.day, hh, mm, tz);
}

/** 下一次应跑实例（> now），用于 UI 展示 / 计算 sleep。 */
export function nextRunAt(schedule: Schedule, now: Date): Date {
  if (schedule.freq === "hourly") {
    const step = (schedule.everyMinutes ?? 60) * 60_000;
    return new Date((Math.floor(now.getTime() / step) + 1) * step);
  }
  const last = lastScheduledInstant(schedule, now);
  if (schedule.freq === "daily") return new Date(last.getTime() + 86_400_000);
  return new Date(last.getTime() + 7 * 86_400_000); // weekly
}

export interface DueVerdict { due: boolean; reason: "due" | "not_due"; instant: Date; }

/** 是否到点该跑（catch-up 感知）：自 lastRun 以来是否有应跑实例已过去。
 *  hourly 用「距上次运行 >= 间隔」语义；daily/weekly 用「最近实例 vs lastRun」。 */
export function isDue(schedule: Schedule, lastRunAt: string | null | undefined, now: Date): DueVerdict {
  if (schedule.freq === "hourly") {
    const interval = (schedule.everyMinutes ?? 60) * 60_000;
    const last = lastRunAt ? new Date(lastRunAt).getTime() : 0;
    const due = !lastRunAt || now.getTime() - last >= interval;
    return { due, reason: due ? "due" : "not_due", instant: new Date(last + interval) };
  }
  const instant = lastScheduledInstant(schedule, now);
  const last = lastRunAt ? new Date(lastRunAt).getTime() : 0;
  const due = last < instant.getTime() && now.getTime() >= instant.getTime();
  return { due, reason: due ? "due" : "not_due", instant };
}
