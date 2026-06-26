// lumina-feed · subscriptions 仓库（实现 M5 调度层所需契约）
import type { SqliteDb } from "./db.ts";
import type { Subscription } from "../schedule/types.ts";

const J = (v: unknown) => JSON.stringify(v ?? null);
const P = (s: any) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };

export class SubscriptionsRepo {
  private db: SqliteDb;
  constructor(db: SqliteDb) { this.db = db; }

  list(): Subscription[] {
    return this.db.prepare("SELECT * FROM subscriptions").all().map(hydrate);
  }
  get(id: string): Subscription | undefined {
    const r = this.db.prepare("SELECT * FROM subscriptions WHERE id=?").get(id);
    return r ? hydrate(r) : undefined;
  }
  save(sub: Subscription): void {
    this.db.prepare(`
      INSERT INTO subscriptions(id,name,query_spec_json,schedule_json,summarize_opts_json,last_run_at,seen_ids_json,enabled,shared_with_json)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, query_spec_json=excluded.query_spec_json,
        schedule_json=excluded.schedule_json, summarize_opts_json=excluded.summarize_opts_json,
        last_run_at=excluded.last_run_at, seen_ids_json=excluded.seen_ids_json, enabled=excluded.enabled`
    ).run(sub.id, sub.name, J(sub.query), J(sub.schedule), J(sub.summarize ?? null),
      sub.lastRunAt ?? null, J(sub.seenIds ?? []), sub.enabled ? 1 : 0, J((sub as any).sharedWith ?? null));
  }
  remove(id: string): void { this.db.prepare("DELETE FROM subscriptions WHERE id=?").run(id); }
}

function hydrate(r: any): Subscription {
  return {
    id: r.id, name: r.name,
    query: P(r.query_spec_json),
    schedule: P(r.schedule_json),
    summarize: P(r.summarize_opts_json),
    lastRunAt: r.last_run_at ?? null,
    seenIds: P(r.seen_ids_json) ?? [],
    enabled: !!r.enabled,
  };
}
