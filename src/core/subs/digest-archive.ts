// 订阅简报 · 历史归档层（digest_retro 补丁）
// 诚实边界：归档的是「你的订阅在某天收到的论文 id」——是你的 feed 捞取记录，**不是领域发表样本**。
// 据此可回看历史每日报告、画「关于你的」回顾图、做跨时间窗 AI 回顾。论文元数据本就在 papers 表（最便宜），
// 这里只存「日期→subId→paperIds」轻量索引。清理频率由 settings.digestHistoryRetentionDays 控制；papers / library 永不在此删除。
import type { Store } from "../store/index.ts";

/** 单条快照里 paperIds 的上限（与 today 上限 50 同量级，留余量给一天多次 run 的并集） */
export const DIGEST_SNAPSHOT_CAP = 400;

export interface DigestSnapshot {
  dateKey: string;
  subId: string;
  paperIds: string[];
  paperCount: number;
  createdAt: string;
}

export interface SnapshotDateRow {
  dateKey: string;
  paperCount: number; // 当日跨订阅去重后的论文数
  subIds: string[];
}

export function ensureSnapshotTable(db: Store["db"]): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS digest_snapshots(date_key TEXT NOT NULL, sub_id TEXT NOT NULL, paper_ids TEXT, paper_count INTEGER, created_at TEXT, PRIMARY KEY(date_key, sub_id));",
  );
}

function parseIds(payload: string | undefined | null): string[] {
  if (!payload) return [];
  try {
    const v = JSON.parse(payload);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 记录某订阅在某天收到的论文（按需并集合并：一天多次 run 累积，不覆盖）。
 * 仅记录「确实在该 dateKey 被投递」的 fresh id —— 调用方负责传当天真正新增的 id。
 */
export function recordDigestSnapshot(
  store: Store,
  dateKey: string,
  subId: string,
  deliveredIds: string[],
): void {
  if (!dateKey || !subId || !Array.isArray(deliveredIds) || deliveredIds.length === 0) return;
  try {
    ensureSnapshotTable(store.db);
    const prev = store.db
      .prepare("SELECT paper_ids FROM digest_snapshots WHERE date_key=? AND sub_id=?")
      .get(dateKey, subId) as { paper_ids?: string } | undefined;
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const id of [...parseIds(prev?.paper_ids), ...deliveredIds.map(String)]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    const capped = merged.slice(-DIGEST_SNAPSHOT_CAP);
    store.db
      .prepare(
        "INSERT INTO digest_snapshots(date_key, sub_id, paper_ids, paper_count, created_at) VALUES(?,?,?,?,?) ON CONFLICT(date_key, sub_id) DO UPDATE SET paper_ids=excluded.paper_ids, paper_count=excluded.paper_count, created_at=excluded.created_at",
      )
      .run(dateKey, subId, JSON.stringify(capped), capped.length, new Date().toISOString());
  } catch {
    /* 归档失败不阻断订阅主流程 */
  }
}

/** 有数据的历史日期（倒序）。subId 省略 = 跨全部订阅。 */
export function listSnapshotDates(store: Store, subId?: string): SnapshotDateRow[] {
  try {
    ensureSnapshotTable(store.db);
    const rows = (subId && subId !== "all"
      ? store.db.prepare("SELECT date_key, sub_id, paper_ids FROM digest_snapshots WHERE sub_id=? ORDER BY date_key DESC").all(subId)
      : store.db.prepare("SELECT date_key, sub_id, paper_ids FROM digest_snapshots ORDER BY date_key DESC").all()
    ) as Array<{ date_key: string; sub_id: string; paper_ids?: string }>;
    const byDate = new Map<string, { ids: Set<string>; subs: Set<string> }>();
    for (const r of rows) {
      let cur = byDate.get(r.date_key);
      if (!cur) {
        cur = { ids: new Set(), subs: new Set() };
        byDate.set(r.date_key, cur);
      }
      cur.subs.add(r.sub_id);
      for (const id of parseIds(r.paper_ids)) cur.ids.add(id);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([dateKey, v]) => ({ dateKey, paperCount: v.ids.size, subIds: [...v.subs] }));
  } catch {
    return [];
  }
}

/** 某天的论文 id（跨订阅去重）。subId 指定则只取该订阅。 */
export function loadSnapshot(store: Store, dateKey: string, subId?: string): DigestSnapshot {
  const empty: DigestSnapshot = { dateKey, subId: subId || "all", paperIds: [], paperCount: 0, createdAt: "" };
  if (!dateKey) return empty;
  try {
    ensureSnapshotTable(store.db);
    const rows = (subId && subId !== "all"
      ? store.db.prepare("SELECT paper_ids, created_at FROM digest_snapshots WHERE date_key=? AND sub_id=?").all(dateKey, subId)
      : store.db.prepare("SELECT paper_ids, created_at FROM digest_snapshots WHERE date_key=?").all(dateKey)
    ) as Array<{ paper_ids?: string; created_at?: string }>;
    const ids: string[] = [];
    const seen = new Set<string>();
    let createdAt = "";
    for (const r of rows) {
      if (r.created_at && r.created_at > createdAt) createdAt = r.created_at;
      for (const id of parseIds(r.paper_ids)) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return { dateKey, subId: subId || "all", paperIds: ids, paperCount: ids.length, createdAt };
  } catch {
    return empty;
  }
}

/** 解析 dateKey "YYYY-MM-DD" 为本地 0 点时间戳 */
export function dateKeyToMs(dateKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * 历史清理：删除早于 retentionDays 的快照 + 对应的 digest_report 缓存行。
 * 红线：**绝不**删除 papers / library / fulltext —— 这些是你的工作集与元数据，与「简报历史」无关。
 * retentionDays 省略 / <=0 => 永久保留（默认慷慨，文本 JSON 很轻）。
 * 返回删除的快照天数（便于日志/测试）。
 */
export function pruneDigestHistory(store: Store, retentionDays?: number): { prunedDates: number } {
  if (!retentionDays || retentionDays <= 0 || !Number.isFinite(retentionDays)) return { prunedDates: 0 };
  try {
    ensureSnapshotTable(store.db);
    store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
    const cutoffMs = Date.now() - retentionDays * 24 * 3600 * 1000;
    const dates = (store.db.prepare("SELECT DISTINCT date_key FROM digest_snapshots").all() as Array<{ date_key: string }>)
      .map((r) => r.date_key)
      .filter((dk) => {
        const t = dateKeyToMs(dk);
        return Number.isFinite(t) && t < cutoffMs;
      });
    let n = 0;
    for (const dk of dates) {
      store.db.prepare("DELETE FROM digest_snapshots WHERE date_key=?").run(dk);
      // 同步删除该日所有 scope 的总报告缓存（digest_report:<dk>:*）
      store.db.prepare("DELETE FROM sources_cache WHERE key LIKE ?").run(`digest_report:${dk}:%`);
      // 删除该日派生的回顾缓存（digest_retro:* 含 dateKey 的窗口缓存由 range 派生，单独清理见 invalidateRetroCache）
      n++;
    }
    return { prunedDates: n };
  } catch {
    return { prunedDates: 0 };
  }
}

/** 订阅删除 / 数据变动时，作废所有回顾派生缓存（重算便宜，宁可失效） */
export function invalidateRetroCache(store: Store): void {
  try {
    store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
    store.db.prepare("DELETE FROM sources_cache WHERE key LIKE 'digest_retro:%'").run();
  } catch {
    /* ignore */
  }
}
