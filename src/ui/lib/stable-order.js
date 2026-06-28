// 流式检索稳定排序（open-sources · 渲染层副本，无 TS 依赖）
export function stableMerge(prevOrder, freshRanked) {
  const freshById = new Map(freshRanked.map((p) => [p.id, p]));
  const shown = [];
  const shownIds = new Set();
  for (const prev of prevOrder) {
    const updated = freshById.get(prev.id);
    if (updated) { shown.push(updated); shownIds.add(prev.id); }
  }
  const appended = [];
  for (const p of freshRanked) if (!shownIds.has(p.id)) appended.push(p);
  return { items: [...shown, ...appended], appended: appended.length };
}

export function adoptRanking(freshRanked) {
  return [...freshRanked];
}
