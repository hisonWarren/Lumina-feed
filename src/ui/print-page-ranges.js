// Lumina Feed · 打印页码范围解析（1-based，闭区间）
// 支持 1-3,5,8–10 / 中文逗号 / 「至」「到」

/**
 * @param {string} spec
 * @param {number} maxPage
 * @returns {{ from: number, to: number }[] | { error: string }}
 */
export function parsePrintPageRanges(spec, maxPage) {
  const max = Math.max(0, Math.floor(Number(maxPage) || 0));
  const raw = String(spec || "").trim();
  if (!raw) return { error: "empty" };
  if (max < 1) return { error: "no_pages" };
  const parts = raw.split(/[,，;；]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: "empty" };
  const out = [];
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*[-–—~～至到]+\s*(\d+)$/);
    const single = part.match(/^(\d+)$/);
    let from;
    let to;
    if (range) {
      from = parseInt(range[1], 10);
      to = parseInt(range[2], 10);
    } else if (single) {
      from = to = parseInt(single[1], 10);
    } else {
      return { error: "bad_token:" + part };
    }
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < 1) {
      return { error: "bad_token:" + part };
    }
    if (from > to) { const t = from; from = to; to = t; }
    if (from > max) return { error: "out_of_range" };
    to = Math.min(to, max);
    out.push({ from, to });
  }
  return out;
}

export function pageRangesForScope(scope, currentPage, customSpec, maxPage) {
  const max = Math.max(0, Math.floor(Number(maxPage) || 0));
  const cur = Math.max(1, Math.min(max || 1, Math.floor(Number(currentPage) || 1)));
  if (scope === "current") return max ? [{ from: cur, to: cur }] : [];
  if (scope === "custom") return parsePrintPageRanges(customSpec, max);
  return [];
}
