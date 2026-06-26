// lumina-feed · 应用设置（存 settings 单行；密钥另走钥匙串）
import type { Store } from "../src/core/store/index.ts";
import type { LlmConfig } from "../src/core/summarize/llm-client.ts";
import type { EmailConfig } from "../src/core/notify/channels/email.ts";
import type { TelegramConfig } from "../src/core/notify/channels/telegram.ts";
import type { WebhookConfig } from "../src/core/notify/channels/webhook.ts";

export interface AppSettings {
  contactEmail?: string;          // 礼貌署名 + OA 解析
  llm?: LlmConfig;                // provider/model/baseUrl（key 在钥匙串）
  backgroundEnabled: boolean;     // B：托盘常驻 + 定时
  channels: {
    email?: EmailConfig;
    telegram?: Omit<TelegramConfig, "botToken">;
    webhook?: Omit<WebhookConfig, "secret">;
  };
}

const DEFAULTS: AppSettings = { backgroundEnabled: true, channels: {} };
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
  // sources_cache 表由 M1 bootstrap 建；这里复用它存设置（单行）
  store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
}
