// Lumina Feed · 共享 UI 工具（patch: find_fetch 前置）
export function isDoi(s) {
  const t = String(s || "").trim();
  return /^10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+$/i.test(t) || /^https?:\/\/(dx\.)?doi\.org\/10\./i.test(t);
}

export function normDoi(s) {
  return String(s || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/\s+$/, "");
}

export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
