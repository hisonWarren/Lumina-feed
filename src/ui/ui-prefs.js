// 轻量 UI 偏好持久化（localStorage / sessionStorage JSON）

export function loadJsonPref(store, key, fallback) {
  try {
    const raw = (store === "session" ? sessionStorage : localStorage).getItem(key);
    if (raw == null || raw === "") return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJsonPref(store, key, value) {
  try {
    (store === "session" ? sessionStorage : localStorage).setItem(key, JSON.stringify(value));
  } catch { /* quota / private mode */ }
}

export function patchJsonPref(store, key, patch) {
  saveJsonPref(store, key, { ...loadJsonPref(store, key, {}), ...patch });
}

export function corpusCacheKey(kind, ids) {
  const sorted = [...ids].map(String).sort();
  return "corpus:" + kind + ":" + sorted.join("|");
}
