// FindFetch · 检索会话快照（Tab 切换 keep-alive + 进程重启恢复）
const STORAGE_KEY = "lumina.findFetch.session";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const SESSION_VERSION = 2;

export function formatSessionAge(ts, now = Date.now()) {
  if (!ts) return "";
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + " 分钟前";
  const hr = Math.floor(min / 60);
  if (hr < 48) return hr + " 小时前";
  return Math.floor(hr / 24) + " 天前";
}

/** @param {object|null} snap */
export function saveFindFetchSession(snap) {
  if (typeof localStorage === "undefined") return;
  try {
    if (!snap || !snap.submitted) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SESSION_VERSION, ...snap, ts: snap.ts || Date.now() }));
  } catch { /* quota / private mode */ }
}

/** @returns {object|null} */
export function loadFindFetchSession(now = Date.now()) {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || snap.v !== SESSION_VERSION || !snap.submitted) return null;
    if (snap.ts && now - snap.ts > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export function clearFindFetchSession() {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** @param {object} snap */
export function sessionSummary(snap) {
  if (!snap || !snap.submitted) return null;
  const count = Array.isArray(snap.results) ? snap.results.length : 0;
  return {
    submitted: snap.submitted,
    count,
    loading: !!snap.loading,
    updatedAt: snap.ts || Date.now(),
    age: formatSessionAge(snap.ts),
  };
}
