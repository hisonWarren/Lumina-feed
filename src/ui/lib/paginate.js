// src/ui/lib/paginate.js
// Pure helpers for CLIENT-SIDE pagination of the BOUNDED merged result set.
// IMPORTANT (红线/范围护栏 01-C·04-§3.6): this pages over the already-fetched, deduped, reranked
// results only. There is NO database total and NO deep/corpus paging — `total` is the length of the
// results the engine actually returned (lookup, not corpus search). No engine change, no re-fetch.

export function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize)));
}
export function clampPage(page, total, pageSize) {
  const n = pageCount(total, pageSize);
  return Math.min(Math.max(1, page | 0), n);
}
export function pageSlice(items, page, pageSize) {
  const p = clampPage(page, (items || []).length, pageSize);
  const start = (p - 1) * pageSize;
  return (items || []).slice(start, start + pageSize);
}
/** 1-based item range for the "第 X–Y 项 / 共 N" label. */
export function rangeLabel(page, pageSize, total) {
  if (!total) return { from: 0, to: 0 };
  const from = (clampPage(page, total, pageSize) - 1) * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return { from, to };
}
/** Compact page-number window with ellipsis: e.g. [1,"…",6,7,8,"…",20]. span = neighbors each side. */
export function pageWindow(page, count, span = 1) {
  if (count <= 1) return [1];
  const p = Math.min(Math.max(1, page), count);
  const nums = [];
  const push = (v) => { if (nums[nums.length - 1] !== v) nums.push(v); };
  push(1);
  for (let i = p - span; i <= p + span; i++) if (i > 1 && i < count) push(i);
  push(count);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    out.push(nums[i]);
    if (i < nums.length - 1 && nums[i + 1] - nums[i] > 1) out.push("…");
  }
  return out;
}
