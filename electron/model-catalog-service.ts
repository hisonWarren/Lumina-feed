// 远程模型清单：拉取 GitHub manifest、本地缓存、注入运行时 curated 列表
import fs from "node:fs";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  MODEL_CATALOG_MANIFEST_URL,
  MODEL_CATALOG_SCHEMA_VERSION,
  buildEffectiveCatalog,
  bundledEffectiveCatalog,
  parseModelCatalogManifest,
  setRuntimeModelCatalog,
  type EffectiveModelCatalog,
  type ModelCatalogManifest,
} from "../src/core/summarize/model-catalog.ts";

const CACHE_FILE = "model-catalog-cache.json";
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

interface CachePayload {
  schemaVersion: number;
  fetchedAt: string;
  manifest: ModelCatalogManifest;
}

let userDataDir = "";
let appVersion = "0.0.0";
let current: EffectiveModelCatalog = bundledEffectiveCatalog();
let refreshInFlight: Promise<EffectiveModelCatalog> | null = null;

function cachePath(): string {
  return path.join(userDataDir, CACHE_FILE);
}

function applyEffective(effective: EffectiveModelCatalog): EffectiveModelCatalog {
  current = effective;
  setRuntimeModelCatalog(effective);
  return effective;
}

async function readCache(): Promise<CachePayload | null> {
  try {
    const raw = await readFile(cachePath(), "utf8");
    const j = JSON.parse(raw) as CachePayload;
    if (!j || j.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION || !j.manifest) return null;
    const manifest = parseModelCatalogManifest(j.manifest);
    if (!manifest || !j.fetchedAt) return null;
    return { schemaVersion: j.schemaVersion, fetchedAt: j.fetchedAt, manifest };
  } catch {
    return null;
  }
}

async function writeCache(manifest: ModelCatalogManifest): Promise<void> {
  const payload: CachePayload = {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    fetchedAt: new Date().toISOString(),
    manifest,
  };
  await writeFile(cachePath(), JSON.stringify(payload, null, 2), "utf8");
}

async function fetchRemoteManifest(): Promise<ModelCatalogManifest | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MODEL_CATALOG_MANIFEST_URL, {
      signal: ac.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j: unknown = await res.json();
    return parseModelCatalogManifest(j);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fromCachePayload(cache: CachePayload, source: "cache" | "remote"): EffectiveModelCatalog {
  return buildEffectiveCatalog(cache.manifest, {
    source,
    updatedAt: cache.fetchedAt,
    manifestUrl: MODEL_CATALOG_MANIFEST_URL,
    appVersion,
  });
}

export function initModelCatalogService(opts: { userDataPath: string; appVersion: string }): void {
  userDataDir = opts.userDataPath;
  appVersion = opts.appVersion || "0.0.0";
  applyEffective(bundledEffectiveCatalog());
}

export function getModelCatalogState(): EffectiveModelCatalog {
  return current;
}

export async function loadModelCatalogFromDisk(): Promise<EffectiveModelCatalog> {
  const cache = await readCache();
  if (cache) return applyEffective(fromCachePayload(cache, "cache"));
  return applyEffective(bundledEffectiveCatalog());
}

export async function refreshModelCatalog(force = false): Promise<EffectiveModelCatalog> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      if (!force) {
        const cache = await readCache();
        if (cache) {
          const age = Date.now() - new Date(cache.fetchedAt).getTime();
          if (Number.isFinite(age) && age >= 0 && age < TTL_MS) {
            return applyEffective(fromCachePayload(cache, "cache"));
          }
        }
      }

      const remote = await fetchRemoteManifest();
      if (remote) {
        try { await writeCache(remote); } catch { /* 缓存失败不阻断 */ }
        return applyEffective(buildEffectiveCatalog(remote, {
          source: "remote",
          updatedAt: new Date().toISOString(),
          manifestUrl: MODEL_CATALOG_MANIFEST_URL,
          appVersion,
        }));
      }

      const cache = await readCache();
      if (cache) return applyEffective(fromCachePayload(cache, "cache"));
      return applyEffective(bundledEffectiveCatalog());
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** 启动时：先读磁盘缓存，再后台尝试刷新。 */
export async function bootstrapModelCatalog(): Promise<void> {
  if (!userDataDir) return;
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch { /* ignore */ }
  await loadModelCatalogFromDisk();
  void refreshModelCatalog(false);
}
