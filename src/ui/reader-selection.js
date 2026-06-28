// Lumina · 阅读器选区捕获（划词浮条 + 右键菜单共用）

/** @returns {null | { text: string, page: number, rects: Array<{x:number,y:number,w:number,h:number}>, x?: number, y?: number }} */
export function captureTextSelection(rootEl, pageFallback, scale) {
  if (!rootEl || typeof window === "undefined") return null;
  const sObj = window.getSelection ? window.getSelection() : null;
  const text = sObj && !sObj.isCollapsed ? sObj.toString().trim() : "";
  if (!text) return null;
  try {
    const range = sObj.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const host = rootEl.getBoundingClientRect();
    let node = range.commonAncestorContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    const pgEl = node && node.closest ? node.closest(".rd-pg") : null;
    const pageNo = pgEl && pgEl.getAttribute("data-page")
      ? parseInt(pgEl.getAttribute("data-page"), 10)
      : pageFallback;
    const rects = [];
    if (pgEl) {
      const pr = pgEl.getBoundingClientRect();
      const crs = range.getClientRects();
      for (let i = 0; i < crs.length; i++) {
        const r = crs[i];
        rects.push({
          x: (r.left - pr.left) / scale,
          y: (r.top - pr.top) / scale,
          w: r.width / scale,
          h: r.height / scale,
        });
      }
    }
    return {
      text,
      page: pageNo,
      rects,
      x: rect.left - host.left + rect.width / 2,
      y: rect.top - host.top,
    };
  } catch {
    return null;
  }
}

export function truncateLabel(text, max = 22) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}
