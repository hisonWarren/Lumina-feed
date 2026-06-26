// lumina-feed · store 装配（单例，便于 digest.ts 与 M5 调度层共享同一 db）
import { type SqliteDb, bootstrap } from "./db.ts";
import { PapersRepo } from "./papers.repo.ts";
import { SubscriptionsRepo } from "./subscriptions.repo.ts";
import { DigestsRepo } from "./digests.repo.ts";

export interface Store { db: SqliteDb; papers: PapersRepo; subs: SubscriptionsRepo; digests: DigestsRepo }

let _store: Store | null = null;

/** 用一个已打开的 SqliteDb 初始化全局 store（建表 + 仓库实例） */
export function initStore(db: SqliteDb): Store {
  bootstrap(db);
  _store = { db, papers: new PapersRepo(db), subs: new SubscriptionsRepo(db), digests: new DigestsRepo(db) };
  return _store;
}
export function getStore(): Store {
  if (!_store) throw new Error("store 未初始化：先 initStore(openBetterSqlite(path) | openNodeSqlite())");
  return _store;
}

export { PapersRepo, SubscriptionsRepo, DigestsRepo };
