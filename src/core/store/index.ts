// lumina-feed · store（干净基线：papers + summaries）
import { type SqliteDb, bootstrap } from "./db.ts";
import { PapersRepo } from "./papers.repo.ts";

export interface Store { db: SqliteDb; papers: PapersRepo }

let _store: Store | null = null;

export function initStore(db: SqliteDb): Store {
  bootstrap(db);
  _store = { db, papers: new PapersRepo(db) };
  return _store;
}

export function getStore(): Store {
  if (!_store) throw new Error("store 未初始化");
  return _store;
}

export { PapersRepo };
