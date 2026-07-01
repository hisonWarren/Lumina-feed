// Lumina · 阅读器接管 PDF 区右键（避免与全局 AppContextMenu 重复）

export function setReaderContextHost(active) {
  if (typeof window !== "undefined") {
    window.__luminaReaderCtxHost = !!active;
  }
}

export function isReaderContextHost() {
  return typeof window !== "undefined" && !!window.__luminaReaderCtxHost;
}

/** 输入框/侧栏 AI 等仍走全局编辑菜单 */
export function shouldReaderHandleContextTarget(target) {
  if (!target || !target.closest) return false;
  if (target.closest("input, textarea, [contenteditable='true']")) return false;
  if (target.closest(".rd-ai, .rd-tp, .rd-anno, .rd-sidepanel, .rd-find-float")) return false;
  if (target.closest(".lf-ctx, .rd-ctx")) return false;
  return !!target.closest(".rd");
}
