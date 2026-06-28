// 右键菜单编辑动作：保留/恢复焦点，避免点击自定义菜单后 paste 失效。

/** @param {EventTarget | null | undefined} el */
export function isTextField(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  return el.isContentEditable;
}

/** @param {EventTarget | null | undefined} el */
export function refocusField(el) {
  if (el && el instanceof HTMLElement && typeof el.focus === "function") {
    el.focus({ preventScroll: true });
  }
}

/** @param {HTMLInputElement | HTMLTextAreaElement} el @param {string} text */
export function insertTextAtCaret(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const val = el.value;
  el.value = val.slice(0, start) + text + val.slice(end);
  const pos = start + text.length;
  el.selectionStart = pos;
  el.selectionEnd = pos;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * 在渲染进程执行编辑动作（用户点击菜单项 = 有效手势）。
 * @returns {Promise<boolean>} true 若已在渲染层完成
 */
export async function runEditAction(action, editTarget) {
  if (!isTextField(editTarget)) return false;
  refocusField(editTarget);

  if (action === "paste") {
    try {
      const text = await navigator.clipboard.readText();
      if (editTarget instanceof HTMLInputElement || editTarget instanceof HTMLTextAreaElement) {
        insertTextAtCaret(editTarget, text);
        return true;
      }
      if (editTarget.isContentEditable) {
        if (document.execCommand("insertText", false, text)) return true;
        if (document.execCommand("paste")) return true;
      }
    } catch { /* fallback IPC */ }
    return false;
  }

  const cmd = action === "selectAll" ? "selectAll" : action;
  if (["cut", "copy", "undo", "redo", "selectAll"].includes(cmd)) {
    try {
      if (document.execCommand(cmd)) return true;
    } catch { /* fallback IPC */ }
  }
  return false;
}
