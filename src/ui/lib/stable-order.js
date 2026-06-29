// 流式检索稳定排序 + 标题精确匹配置顶（定位场景）
const EXACT_RANK = { title_exact: 0, title_strong: 1, normal: 2 };

export function pinExactMatches(ranked) {
  if (!ranked || !ranked.length) return ranked || [];
  const exact = [];
  const rest = [];
  for (const p of ranked) {
    if (p.matchKind === "title_exact" || p.matchKind === "title_strong") exact.push(p);
    else rest.push(p);
  }
  exact.sort((a, b) => (EXACT_RANK[a.matchKind] ?? 9) - (EXACT_RANK[b.matchKind] ?? 9));
  const seen = new Set();
  const out = [];
  for (const p of [...exact, ...rest]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export function pinPrimaryId(ranked, primaryId) {
  if (!primaryId || !ranked?.length) return pinExactMatches(ranked);
  const idx = ranked.findIndex((p) => p.id === primaryId);
  if (idx <= 0) return pinExactMatches(ranked);
  const copy = [...ranked];
  const [hit] = copy.splice(idx, 1);
  return pinExactMatches([hit, ...copy]);
}

export function stableMerge(prevOrder, freshRanked) {
  const pinned = pinExactMatches(freshRanked);
  const freshById = new Map(pinned.map((p) => [p.id, p]));
  const shown = [];
  const shownIds = new Set();
  for (const prev of prevOrder) {
    const updated = freshById.get(prev.id);
    if (updated) {
      const citesOut = (prev.cites != null || updated.cites != null)
        ? Math.max(prev.cites ?? -1, updated.cites ?? -1)
        : null;
      shown.push({ ...updated, cites: citesOut });
      shownIds.add(prev.id);
    }
  }
  const appended = [];
  for (const p of pinned) if (!shownIds.has(p.id)) appended.push(p);
  return { items: pinExactMatches([...shown, ...appended]), appended: appended.length };
}

export function adoptRanking(freshRanked) {
  return pinExactMatches([...freshRanked]);
}

export function mergeStreamResults(prev, freshRanked, primaryPaperId) {
  const { items, appended } = stableMerge(prev, freshRanked);
  return {
    items: primaryPaperId ? pinPrimaryId(items, primaryPaperId) : items,
    appended,
  };
}
