/** 订阅待读计数（与 core/subs/digest-search 语义一致，供渲染层使用） */

export function subscriptionReadIds(sub) {
  if (!sub) return new Set();
  return new Set((Array.isArray(sub.readIds) ? sub.readIds : []).map(String));
}

export function todayPaperList(sub) {
  if (!sub || !Array.isArray(sub.today)) return [];
  return sub.today.filter((p) => p && typeof p === "object" && p.id);
}

export function unreadTodayCount(sub) {
  if (!sub || sub.enabled === false) return 0;
  const read = subscriptionReadIds(sub);
  return todayPaperList(sub).filter((p) => !read.has(p.id)).length;
}

export function countSubsUnread(subs) {
  return (Array.isArray(subs) ? subs : []).reduce((n, sub) => n + unreadTodayCount(sub), 0);
}

export function isPaperUnread(sub, paperId) {
  return todayPaperList(sub).some((p) => p.id === paperId) && !subscriptionReadIds(sub).has(paperId);
}
