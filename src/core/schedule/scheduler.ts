// lumina-feed · 调度引擎
// 进程内 tick 循环（默认 60s 检查一次），对每个启用订阅判定 due（含补漏跑），
// 非安静时段则取增量 → 去重 → 生成简报 → 通知 → 推进 lastRun。
// 用 setInterval 而非 node-cron：对休眠/漏跑更稳健（cron 不补漏跑）。
import {
  type Subscription, type Digest, type DigestItem, type RunResult,
  type Clock, type Logger, systemClock, consoleLogger,
} from "./types.ts";
import { isDue, withinQuietHours } from "./due.ts";

const SEEN_CAP = 800; // 去重记忆上限，按时间截断

export interface SchedulerDeps {
  clock?: Clock;
  logger?: Logger;
  /** 读取全部订阅（通常来自 SQLite） */
  loadSubscriptions(): Promise<Subscription[]> | Subscription[];
  /** 持久化订阅（lastRunAt / seenIds 变更后） */
  saveSubscription(sub: Subscription): Promise<void> | void;
  /** 取「自 sinceISO 起」该订阅的命中并（按选项）生成 DigestItem。由 M1 适配器 + M4 总结实现。 */
  runDigest(sub: Subscription, sinceISO: string | null): Promise<{ items: DigestItem[] }>;
  /** 推送一份简报到各通道（Notifier）。 */
  notify(digest: Digest): Promise<unknown> | unknown;
  /** 每个订阅处理完的回调（UI 刷新/写 digests 表） */
  onResult?: (r: RunResult) => void;
}

export class Scheduler {
  private deps: SchedulerDeps;
  private clock: Clock;
  private log: Logger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.logger ?? consoleLogger;
  }

  /** 跑一轮：遍历订阅，按 due 判定执行。并发安全（重入保护）。 */
  async tick(): Promise<RunResult[]> {
    if (this.running) { this.log("warn", "tick 重入，跳过本轮"); return []; }
    this.running = true;
    const out: RunResult[] = [];
    try {
      const subs = await this.deps.loadSubscriptions();
      const now = this.clock.now();
      for (const sub of subs) {
        const r = await this.processOne(sub, now);
        out.push(r);
        this.deps.onResult?.(r);
      }
    } catch (e) {
      this.log("error", "tick 失败", e);
    } finally {
      this.running = false;
    }
    return out;
  }

  private async processOne(sub: Subscription, now: Date): Promise<RunResult> {
    const ranAt = now.toISOString();
    if (!sub.enabled) return { subscriptionId: sub.id, ranAt, newCount: 0, skipped: "disabled" };

    const verdict = isDue(sub.schedule, sub.lastRunAt, now);
    if (!verdict.due) return { subscriptionId: sub.id, ranAt, newCount: 0, skipped: "not_due" };

    // 到点但在安静时段：本轮不跑也不推进 lastRun，安静结束后下一轮补发
    if (withinQuietHours(now, sub.schedule.tz, sub.schedule.quietHours))
      return { subscriptionId: sub.id, ranAt, newCount: 0, skipped: "quiet_hours" };

    try {
      const since = sub.lastRunAt ?? null;
      const { items } = await this.deps.runDigest(sub, since);
      const seen = new Set(sub.seenIds ?? []);
      const fresh = items.filter((it) => it.id && !seen.has(it.id));

      // 无论有无新命中都推进 lastRunAt（避免本轮反复重跑）
      const nextSeen = [...(sub.seenIds ?? []), ...fresh.map((i) => i.id)].slice(-SEEN_CAP);
      const updated: Subscription = { ...sub, lastRunAt: ranAt, seenIds: nextSeen };
      await this.deps.saveSubscription(updated);

      if (fresh.length === 0) {
        this.log("info", `『${sub.name}』本轮无新命中`);
        return { subscriptionId: sub.id, ranAt, newCount: 0, skipped: "no_new" };
      }

      const digest: Digest = {
        subscriptionId: sub.id,
        subscriptionName: sub.name,
        date: ranAt.slice(0, 10),
        items: fresh,
        stats: buildStats(fresh),
        generatedAt: ranAt,
      };
      await this.deps.notify(digest);
      this.log("info", `『${sub.name}』推送 ${fresh.length} 篇`);
      return { subscriptionId: sub.id, ranAt, newCount: fresh.length, digest };
    } catch (e) {
      this.log("error", `『${sub.name}』运行失败`, e);
      return { subscriptionId: sub.id, ranAt, newCount: 0, error: String((e as Error)?.message ?? e) };
    }
  }

  /** 立刻为某订阅跑一次（手动/补发），忽略 due 与安静时段。 */
  async runNow(subId: string): Promise<RunResult> {
    const subs = await this.deps.loadSubscriptions();
    const sub = subs.find((s) => s.id === subId);
    if (!sub) return { subscriptionId: subId, ranAt: this.clock.now().toISOString(), newCount: 0, error: "订阅不存在" };
    const now = this.clock.now();
    const ranAt = now.toISOString();
    const { items } = await this.deps.runDigest(sub, sub.lastRunAt ?? null);
    const seen = new Set(sub.seenIds ?? []);
    const fresh = items.filter((it) => it.id && !seen.has(it.id));
    const updated: Subscription = { ...sub, lastRunAt: ranAt, seenIds: [...(sub.seenIds ?? []), ...fresh.map((i) => i.id)].slice(-SEEN_CAP) };
    await this.deps.saveSubscription(updated);
    if (fresh.length === 0) return { subscriptionId: subId, ranAt, newCount: 0, skipped: "no_new" };
    const digest: Digest = { subscriptionId: sub.id, subscriptionName: sub.name, date: ranAt.slice(0, 10), items: fresh, stats: buildStats(fresh), generatedAt: ranAt };
    await this.deps.notify(digest);
    return { subscriptionId: subId, ranAt, newCount: fresh.length, digest };
  }

  /** 启动 tick 循环（Electron 主进程 / worker daemon）。立刻跑一次做 catch-up。 */
  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.log("info", `调度启动，每 ${Math.round(intervalMs / 1000)}s 检查一次`);
    void this.tick(); // 启动即追赶
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

function buildStats(items: DigestItem[]): Record<string, number> {
  const s: Record<string, number> = { total: items.length, preprints: 0, withFulltext: 0 };
  for (const it of items) {
    if (it.isPreprint) s.preprints++;
    if (it.sourceBasis === "fulltext") s.withFulltext++;
  }
  return s;
}
