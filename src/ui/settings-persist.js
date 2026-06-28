// 设置即时持久化：合并 patch 写入 DB，剥离 getSettings 派生只读字段。
import { hasBackend } from "./lumina-bridge.js";

const VIEW_ONLY = ["emailConfigured", "emailFromEnv"];

function stripViewOnly(obj) {
  const next = { ...obj };
  for (const k of VIEW_ONLY) delete next[k];
  return next;
}

/** @param {(cur: object) => object} mergeFn */
export async function persistSettings(mergeFn) {
  const api = typeof window !== "undefined" ? window.luminaApi : null;
  if (!api || !api.getSettings || !api.saveSettings) return { ok: false, error: "no_backend" };
  try {
    const cur = stripViewOnly((await api.getSettings()) || {});
    const merged = stripViewOnly(typeof mergeFn === "function" ? mergeFn(cur) : { ...cur, ...mergeFn });
    await api.saveSettings(merged);
    return { ok: true };
  } catch {
    return { ok: false, error: "save_failed" };
  }
}

export function settingsBackendReady() {
  return hasBackend();
}
