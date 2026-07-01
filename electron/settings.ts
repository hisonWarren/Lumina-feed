// lumina-feed · 应用设置（LLM + 联系邮箱 + 检索深度）
// open-sources 补丁：新增 searchDepth；settings:get 派生 emailConfigured / emailFromEnv。
// 红线 3：API Key（core/lens/semanticscholar）**不进 AppSettings**——它们只入 OS 钥匙串（secrets:set）。
// 本文件因此**没有** sourceKeys 字段；面板用 secrets.get 在 main 侧判断"已配置"布尔（见 WIRING）。
import type { Store } from "../src/core/store/index.ts";
import type { LlmConfig } from "../src/core/summarize/llm-client.ts";
import { PROVIDER_DEFAULT_MODEL } from "../src/core/summarize/model-presets.ts";

export interface AppSettings {
  contactEmail?: string;
  searchDepth?: "standard" | "full";   // 检索广度：每源 25/50 条上限（非密钥）
  /** 全文库镜像覆盖（LibGen / Anna / Sci-Hub URL 列表，非密钥） */
  altMirrors?: { libgen?: string[]; annas?: string[]; scihub?: string[] };
  /** 取文后自动加入我的文献（工作集）；关则仅落盘，需手动收藏 */
  autoIngestOnFetch?: boolean;
  /** P10 · 标识符定位后后台预取（默认关，须用户在设置中开启） */
  prefetchOnIdentifier?: boolean;
  /** OA 检索命中后台预取（默认关） */
  prefetchOaResults?: boolean;
  /** Primary 定位且全文就绪后自动打开阅读器（默认关） */
  primaryAutoOpenReader?: boolean;
  /** P8 · 用户禁用的检索源 id 列表（如 ["zenodo","openaire"]） */
  disabledSources?: string[];
  /** 桌面通知总开关（Settings 通用页） */
  notifications?: boolean;
  /** 订阅简报系统通知：calm=仅 app 内 · regular=汇总一条 · power=每订阅一条 */
  digestNotifyTier?: "calm" | "regular" | "power";
  /** 检索完成后自动生成「今日简报总报告」（默认开） */
  digestReportAuto?: boolean;
  /** 简报历史保留天数（snapshots + 每日报告缓存）；<=0 或省略=永久保留。papers / 工作集永不受此清理 */
  digestHistoryRetentionDays?: number;
  /** 关窗最小化到托盘 + 开机自启（Settings 通用页） */
  app?: { minimizeToTray?: boolean; openAtLogin?: boolean };
  prompts?: {
    onboardingEmailDismissed?: boolean;
    searchEmailShown?: boolean;
    fetchEmailShown?: boolean;
    /** 一次性：v0.4.14 将旧版默认开启的预取开关重置为关 */
    prefetchManualOnlyV0414?: boolean;
    /** 首次创建订阅后：后台运行说明横幅 */
    subsBackgroundHintDismissed?: boolean;
  };
  llm?: LlmConfig;
  theme?: string;
  reader?: { rememberPos?: boolean; defaultZoom?: number; nightInvert?: boolean; positions?: Record<string, number> };
  /** 跨篇分析：语料深度、篇数上限、是否并入单篇结构化缓存 */
  corpus?: { depth?: "structured" | "fulltext_excerpt"; maxPapers?: number; useLedger?: boolean };
}

/** settings:get 对外返回（派生只读字段；不含任何密钥明文） */
export interface AppSettingsView extends AppSettings {
  emailConfigured: boolean;
  emailFromEnv: boolean;
}

const DEFAULTS: AppSettings = {
  searchDepth: "standard",
  digestNotifyTier: "regular",
  digestReportAuto: true,
  digestHistoryRetentionDays: 365,
  autoIngestOnFetch: true,
  prefetchOnIdentifier: false,
  prefetchOaResults: false,
  primaryAutoOpenReader: false,
  corpus: { depth: "structured", maxPapers: 24, useLedger: true },
};
const KEY = "app_settings";
/** 钥匙串存在、但 settings 缺 llm.provider 时按此顺序探测（升级/重装后 DB 与钥匙串不同步的根因修复） */
const LLM_KEY_PROVIDERS = ["deepseek", "anthropic", "openai", "moonshot", "doubao"] as const;
/** settings:get 派生字段，禁止写入 DB */
const VIEW_ONLY_KEYS = new Set(["emailConfigured", "emailFromEnv"]);
/** 浅合并时保留子对象字段，避免 partial save 抹掉 sibling 键 */
const NESTED_MERGE_KEYS = ["llm", "reader", "app", "prompts", "altMirrors", "corpus"] as const;

export async function loadAppSettings(store: Store): Promise<AppSettings> {
  ensure(store);
  const r = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(KEY);
  if (!r?.payload) return DEFAULTS;
  try {
    const parsed = JSON.parse(r.payload) as AppSettings;
    const merged: AppSettings = { ...DEFAULTS, ...parsed };
    if (!parsed.prompts?.prefetchManualOnlyV0414) {
      merged.prefetchOnIdentifier = false;
      merged.prefetchOaResults = false;
      merged.primaryAutoOpenReader = false;
      merged.prompts = { ...merged.prompts, prefetchManualOnlyV0414: true };
      const toSave = { ...merged };
      store.db.prepare(
        `INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?)
         ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`,
      ).run(KEY, JSON.stringify(toSave), new Date().toISOString());
    }
    return merged;
  } catch { return DEFAULTS; }
}

/**
 * 升级/重装后常见：钥匙串仍保留 `{provider}_key`，但 app_settings 里 llm 块丢失。
 * 设置页用 React 默认值 + secretHas 会显得「已配置」，而 llm:status 读 DB 仍报未配置。
 * 探测到密钥时自动补写 provider/model（不读密钥明文）。
 */
export async function hydrateLlmSettings(
  store: Store,
  hasSecret: (secretName: string) => Promise<boolean>,
  settings?: AppSettings,
): Promise<AppSettings> {
  const s = settings ?? await loadAppSettings(store);
  if (s.llm?.provider) return s;
  const found: string[] = [];
  for (const p of LLM_KEY_PROVIDERS) {
    if (await hasSecret(`${p}_key`)) found.push(p);
  }
  if (!found.length) return s;
  const provider = found.length === 1
    ? found[0]
    : (found.includes("deepseek") ? "deepseek" : found[0]);
  const llm: LlmConfig = {
    ...(s.llm || {}),
    provider,
    model: String(s.llm?.model || "").trim() || PROVIDER_DEFAULT_MODEL[provider] || "",
  };
  await saveAppSettings(store, { llm });
  return { ...s, llm };
}

/** main 侧用：附加派生字段，邮箱来自 settings 或 env（env 优先级见 setPoliteIdentity）。 */
export async function loadAppSettingsView(
  store: Store,
  hasSecret?: (secretName: string) => Promise<boolean>,
): Promise<AppSettingsView> {
  let s = await loadAppSettings(store);
  if (hasSecret) s = await hydrateLlmSettings(store, hasSecret, s);
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
