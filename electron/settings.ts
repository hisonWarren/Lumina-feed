// lumina-feed · 应用设置（LLM + 联系邮箱）
import type { Store } from "../src/core/store/index.ts";
import type { LlmConfig } from "../src/core/summarize/llm-client.ts";

export interface AppSettings {
  contactEmail?: string;
  llm?: LlmConfig;
}

const DEFAULTS: AppSettings = {};
const KEY = "app_settings";

export async function loadAppSettings(store: Store): Promise<AppSettings> {
  ensure(store);
  const r = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(KEY);
  if (!r?.payload) return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(r.payload) }; } catch { return DEFAULTS; }
}

export async function saveAppSettings(store: Store, s: Partial<AppSettings>): Promise<void> {
  ensure(store);
  const merged = { ...(await loadAppSettings(store)), ...s };
  store.db.prepare(
    `INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`
  ).run(KEY, JSON.stringify(merged), new Date().toISOString());
}

function ensure(store: Store): void {
  store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
}
