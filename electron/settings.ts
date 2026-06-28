// lumina-feed · 应用设置（LLM + 联系邮箱 + 检索深度）
// open-sources 补丁：新增 searchDepth；settings:get 派生 emailConfigured / emailFromEnv。
// 红线 3：API Key（core/lens/semanticscholar）**不进 AppSettings**——它们只入 OS 钥匙串（secrets:set）。
// 本文件因此**没有** sourceKeys 字段；面板用 secrets.get 在 main 侧判断"已配置"布尔（见 WIRING）。
import type { Store } from "../src/core/store/index.ts";
import type { LlmConfig } from "../src/core/summarize/llm-client.ts";

export interface AppSettings {
  contactEmail?: string;
  searchDepth?: "standard" | "full";   // 检索深度（非密钥）
  /** 全文库镜像覆盖（LibGen / Anna / Sci-Hub URL 列表，非密钥） */
  altMirrors?: { libgen?: string[]; annas?: string[]; scihub?: string[] };
  /** 取文后自动加入我的文献（工作集）；关则仅落盘，需手动收藏 */
  autoIngestOnFetch?: boolean;
  /** P10 · 标识符直达成功后后台预取全文（默认关） */
  prefetchOnIdentifier?: boolean;
  /** P8 · 用户禁用的检索源 id 列表（如 ["zenodo","openaire"]） */
  disabledSources?: string[];
  /** 桌面通知总开关（Settings 通用页） */
  notifications?: boolean;
  /** 订阅简报系统通知：calm=仅 app 内 · regular=汇总一条 · power=每订阅一条 */
  digestNotifyTier?: "calm" | "regular" | "power";
  /** 关窗最小化到托盘 + 开机自启（Settings 通用页） */
  app?: { minimizeToTray?: boolean; openAtLogin?: boolean };
  prompts?: {
    onboardingEmailDismissed?: boolean;
    searchEmailShown?: boolean;
    fetchEmailShown?: boolean;
  };
  llm?: LlmConfig;
  theme?: string;
  reader?: { rememberPos?: boolean; defaultZoom?: number; nightInvert?: boolean; positions?: Record<string, number> };
}

/** settings:get 对外返回（派生只读字段；不含任何密钥明文） */
export interface AppSettingsView extends AppSettings {
  emailConfigured: boolean;
  emailFromEnv: boolean;
}

const DEFAULTS: AppSettings = { searchDepth: "standard", digestNotifyTier: "regular", autoIngestOnFetch: true };
const KEY = "app_settings";
/** settings:get 派生字段，禁止写入 DB */
const VIEW_ONLY_KEYS = new Set(["emailConfigured", "emailFromEnv"]);
/** 浅合并时保留子对象字段，避免 partial save 抹掉 sibling 键 */
const NESTED_MERGE_KEYS = ["llm", "reader", "app", "prompts", "altMirrors"] as const;

export async function loadAppSettings(store: Store): Promise<AppSettings> {
  ensure(store);
  const r = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(KEY);
  if (!r?.payload) return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(r.payload) }; } catch { return DEFAULTS; }
}

/** main 侧用：附加派生字段，邮箱来自 settings 或 env（env 优先级见 setPoliteIdentity）。 */
export async function loadAppSettingsView(store: Store): Promise<AppSettingsView> {
  const s = await loadAppSettings(store);
  const envEmail = process.env.LUMINA_CONTACT_EMAIL;
  return {
    ...s,
    emailConfigured: !!(s.contactEmail || envEmail),
    emailFromEnv: !s.contactEmail && !!envEmail,
  };
}

export async function saveAppSettings(store: Store, s: Partial<AppSettings>): Promise<void> {
  ensure(store);
  // 防御：即使调用方误传，也绝不持久化任何 *key/*token/*secret 字段（红线 3）
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (/key|token|secret/i.test(k)) continue;
    if (VIEW_ONLY_KEYS.has(k)) continue;
    clean[k] = v;
  }
  const merged = { ...(await loadAppSettings(store)), ...clean } as Record<string, unknown>;
  for (const k of NESTED_MERGE_KEYS) {
    if (clean[k] && typeof clean[k] === "object" && !Array.isArray(clean[k])) {
      merged[k] = { ...((merged[k] as object) || {}), ...(clean[k] as object) };
    }
  }
  for (const k of VIEW_ONLY_KEYS) delete merged[k];
  store.db.prepare(
    `INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`
  ).run(KEY, JSON.stringify(merged), new Date().toISOString());
}

function ensure(store: Store): void {
  store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
}
