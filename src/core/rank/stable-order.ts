// src/core/rank/stable-order.ts
// Streaming stability (fixes review F3 reshuffle): as slow sources arrive, the VISIBLE list must not
// reorder under the user. Keep the order of already-shown items; append genuinely new items at the
// bottom (in reranked order). Surface `appended` for a "刷新排序 (N)" affordance.
export interface Identified { id: string; }
export interface StableResult<T extends Identified> { items: T[]; appended: number; }

export function stableMerge<T extends Identified>(prevOrder: T[], freshRanked: T[]): StableResult<T> {
  const freshById = new Map(freshRanked.map((p) => [p.id, p]));
  const shown: T[] = [];
  const shownIds = new Set<string>();
  for (const prev of prevOrder) {
    const updated = freshById.get(prev.id);
    if (updated) { shown.push(updated); shownIds.add(prev.id); }   // keep position, refresh content
  }
  const appended: T[] = [];
  for (const p of freshRanked) if (!shownIds.has(p.id)) appended.push(p);   // new arrivals in rank order
  return { items: [...shown, ...appended], appended: appended.length };
}

export function adoptRanking<T extends Identified>(freshRanked: T[]): T[] { return [...freshRanked]; }
