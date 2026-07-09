/**
 * 远程模型清单 manifest：GitHub raw 自动更新 + 内置兜底。
 * 发布新模型时更新 config/model-catalog.json 并 push 到 Lumina-feed main，无需发版。
 */
import { CURATED_MODELS, PROVIDER_DEFAULT_MODEL } from "./model-bundled.ts";

export const MODEL_CATALOG_SCHEMA_VERSION = 1;
export const MODEL_CATALOG_MANIFEST_URL =
  "https://raw.githubusercontent.com/hisonWarren/Lumina-feed/main/config/model-catalog.json";

export const MODEL_CATALOG_PROVIDER_KEYS = [
  "deepseek", "anthropic", "openai", "moonshot", "doubao",
] as const;

export type ModelCatalogProviderKey = (typeof MODEL_CATALOG_PROVIDER_KEYS)[number];

export interface ModelCatalogProviderEntry {
  models: string[];
  defaultModel?: string;
}

export interface ModelCatalogManifest {
  schemaVersion: number;
  catalogVerified?: string;
  minAppVersion?: string;
  sources?: Record<string, string>;
  providers: Record<string, ModelCatalogProviderEntry>;
}

export type ModelCatalogSource = "remote" | "cache" | "bundled";

export interface EffectiveModelCatalog {
  curated: Record<string, readonly string[]>;
  defaults: Record<string, string>;
  sources: Record<string, string>;
  source: ModelCatalogSource;
  catalogVerified: string | null;
  updatedAt: string | null;
  manifestUrl: string;
}

const MAX_MODELS_PER_PROVIDER = 64;
const MAX_MODEL_ID_LEN = 128;

let runtimeCurated: Record<string, readonly string[]> | null = null;
let runtimeDefaults: Record<string, string> | null = null;
let runtimeMeta: Pick<EffectiveModelCatalog, "source" | "catalogVerified" | "updatedAt" | "manifestUrl"> | null = null;

export function setRuntimeModelCatalog(effective: EffectiveModelCatalog | null): void {
  if (!effective) {
    runtimeCurated = null;
    runtimeDefaults = null;
    runtimeMeta = null;
    return;
  }
  runtimeCurated = effective.curated;
  runtimeDefaults = effective.defaults;
  runtimeMeta = {
    source: effective.source,
    catalogVerified: effective.catalogVerified,
    updatedAt: effective.updatedAt,
    manifestUrl: effective.manifestUrl,
  };
}

export function getRuntimeModelCatalogMeta(): typeof runtimeMeta {
  return runtimeMeta;
}

export function getCuratedModels(provider: string): readonly string[] | undefined {
  const fromRuntime = runtimeCurated?.[provider];
  if (fromRuntime?.length) return fromRuntime;
  return CURATED_MODELS[provider];
}

export function getProviderDefaultModel(provider: string): string | undefined {
  return runtimeDefaults?.[provider] ?? PROVIDER_DEFAULT_MODEL[provider];
}

function isProviderKey(k: string): k is ModelCatalogProviderKey {
  return (MODEL_CATALOG_PROVIDER_KEYS as readonly string[]).includes(k);
}

function parseSemver(v: string): [number, number, number] | null {
  const m = String(v || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** appVersion >= minAppVersion（仅比较 x.y.z 前缀） */
export function appVersionMeetsMin(appVersion: string, minAppVersion: string): boolean {
  const a = parseSemver(appVersion);
  const b = parseSemver(minAppVersion);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

function sanitizeModelIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!id || id.length > MAX_MODEL_ID_LEN) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length > MAX_MODELS_PER_PROVIDER) return null;
  }
  return out.length ? out : null;
}

/** 校验 manifest 结构；失败返回 null（不落盘、不覆盖运行时）。 */
export function parseModelCatalogManifest(raw: unknown): ModelCatalogManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION) return null;
  if (!o.providers || typeof o.providers !== "object") return null;
  const providers: Record<string, ModelCatalogProviderEntry> = {};
  for (const [key, val] of Object.entries(o.providers as Record<string, unknown>)) {
    if (!isProviderKey(key)) continue;
    if (!val || typeof val !== "object") return null;
    const entry = val as Record<string, unknown>;
    const models = sanitizeModelIds(entry.models);
    if (!models) return null;
    const defaultModel = entry.defaultModel != null ? String(entry.defaultModel).trim() : undefined;
    if (defaultModel && !models.includes(defaultModel)) return null;
    providers[key] = { models, ...(defaultModel ? { defaultModel } : {}) };
  }
  if (!Object.keys(providers).length) return null;
  const sources: Record<string, string> = {};
  if (o.sources && typeof o.sources === "object") {
    for (const [k, v] of Object.entries(o.sources as Record<string, unknown>)) {
      const url = String(v || "").trim();
      if (url.startsWith("https://")) sources[k] = url;
    }
  }
  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    catalogVerified: typeof o.catalogVerified === "string" ? o.catalogVerified : undefined,
    minAppVersion: typeof o.minAppVersion === "string" ? o.minAppVersion : undefined,
    sources: Object.keys(sources).length ? sources : undefined,
    providers,
  };
}

/** 将 manifest 与内置清单合并：manifest 优先，缺项回落内置。 */
export function buildEffectiveCatalog(
  manifest: ModelCatalogManifest | null,
  opts: {
    source: ModelCatalogSource;
    updatedAt?: string | null;
    manifestUrl?: string;
    appVersion?: string;
  },
): EffectiveModelCatalog {
  const curated: Record<string, string[]> = {};
  const defaults: Record<string, string> = { ...PROVIDER_DEFAULT_MODEL };
  const sources: Record<string, string> = {};

  const useManifest = manifest && (!manifest.minAppVersion || !opts.appVersion || appVersionMeetsMin(opts.appVersion, manifest.minAppVersion));

  for (const key of MODEL_CATALOG_PROVIDER_KEYS) {
    const bundled = CURATED_MODELS[key] ? [...CURATED_MODELS[key]] : [];
    const remote = useManifest ? manifest!.providers[key] : undefined;
    if (remote?.models?.length) {
      const seen = new Set<string>();
      const merged: string[] = [];
      const push = (m: string) => {
        if (!m || seen.has(m)) return;
        seen.add(m);
        merged.push(m);
      };
      for (const m of remote.models) push(m);
      for (const m of bundled) push(m);
      curated[key] = merged;
      if (remote.defaultModel) defaults[key] = remote.defaultModel;
    } else if (bundled.length) {
      curated[key] = bundled;
    }
  }

  if (useManifest?.sources) {
    for (const [k, v] of Object.entries(manifest!.sources!)) sources[k] = v;
  }

  return {
    curated,
    defaults,
    sources,
    source: opts.source,
    catalogVerified: useManifest ? (manifest!.catalogVerified || null) : null,
    updatedAt: opts.updatedAt ?? null,
    manifestUrl: opts.manifestUrl || MODEL_CATALOG_MANIFEST_URL,
  };
}

export function bundledEffectiveCatalog(): EffectiveModelCatalog {
  return buildEffectiveCatalog(null, { source: "bundled" });
}
