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

/** 今日 dateKey（本地时区），与 core digest-report 一致 */
export function digestDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 综合简报是否需按当前订阅状态重新生成（渲染层轻量版，与 core digest-report 对齐）。
 */
export function digestReportNeedsRefresh(report, subs, scope, dateKey = digestDateKey()) {
  if (!report || report.status === "idle") return true;
  if (report.status !== "ready") return false;
  const enabled = (Array.isArray(subs) ? subs : []).filter((s) => s && s.enabled !== false);
  const scoped = scope === "all"
    ? enabled
    : enabled.filter((s) => String(s.id) === scope);
  const todayScoped = scoped.filter((s) => String(s.todayDateKey || "") === dateKey);
  const unreadCount = todayScoped.reduce((n, s) => n + unreadTodayCount(s), 0);
  if (report.unreadCount !== unreadCount || report.subCount !== todayScoped.length) return true;
  if (scope === "all") {
    const expected = todayScoped
      .filter((s) => unreadTodayCount(s) > 0)
      .map((s) => String(s.id))
      .sort();
    if (!report.contributingSubIds?.length || !report.brief) return expected.length > 0;
    const covered = report.contributingSubIds.slice().sort();
    if (expected.length !== covered.length) return true;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== covered[i]) return true;
    }
    if (expected.length > 1 && (!report.subSpotlights || report.subSpotlights.length < expected.length)) return true;
  }
  if (!report.brief) return true;
  return false;
}
