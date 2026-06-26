// lumina-feed · digests 仓库（历史简报，供「今日推送」与回看）
import type { SqliteDb } from "./db.ts";
import type { Digest } from "../schedule/types.ts";

const J = (v: unknown) => JSON.stringify(v ?? null);
const P = (s: any) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };

export class DigestsRepo {
  private db: SqliteDb;
  constructor(db: SqliteDb) { this.db = db; }

  save(d: Digest): void {
    const id = `${d.subscriptionId}:${d.date}`;
    this.db.prepare(`
      INSERT INTO digests(id,date,subscription_id,paper_ids_json,stats_json,generated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET paper_ids_json=excluded.paper_ids_json, stats_json=excluded.stats_json, generated_at=excluded.generated_at`
    ).run(id, d.date, d.subscriptionId, J(d.items.map((i) => i.id)), J(d.stats ?? {}), d.generatedAt);
  }
  byDate(date: string): Array<{ subscriptionId: string; date: string; paperIds: string[]; stats: any }> {
    return this.db.prepare("SELECT * FROM digests WHERE date=?").all(date).map(row);
  }
  bySubscription(subId: string, limit = 30): Array<{ subscriptionId: string; date: string; paperIds: string[]; stats: any }> {
    return this.db.prepare("SELECT * FROM digests WHERE subscription_id=? ORDER BY date DESC LIMIT ?").all(subId, limit).map(row);
  }
}

function row(r: any) {
  return { subscriptionId: r.subscription_id, date: r.date, paperIds: P(r.paper_ids_json) ?? [], stats: P(r.stats_json) ?? {} };
}
