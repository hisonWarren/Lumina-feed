// Lumina · 右键菜单：主进程转发 + 编辑动作（渲染层展示主题化中文菜单）
import { clipboard, shell, type BrowserWindow, type WebContents } from "electron";

export const CONTEXT_MENU_CHANNEL = "lumina:context-menu";

export type ContextMenuPayload = {
  x: number;
  y: number;
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
};

export function shouldShowContextMenu(params: Electron.ContextMenuParams): boolean {
  if (params.isEditable) return true;
  if ((params.selectionText || "").trim()) return true;
  if (params.linkURL) return true;
  return false;
}

export function buildContextMenuPayload(params: Electron.ContextMenuParams): ContextMenuPayload {
  return {
    x: params.x,
    y: params.y,
    isEditable: !!params.isEditable,
    selectionText: params.selectionText || "",
    linkURL: params.linkURL || "",
    editFlags: {
      canUndo: params.editFlags.canUndo,
      canRedo: params.editFlags.canRedo,
      canCut: params.editFlags.canCut,
      canCopy: params.editFlags.canCopy,
      canPaste: params.editFlags.canPaste,
      canSelectAll: params.editFlags.canSelectAll,
    },
  };
}

export function installContextMenuBridge(w: BrowserWindow): void {
  w.webContents.on("context-menu", (_e, params) => {
    if (!shouldShowContextMenu(params)) return;
    w.webContents.send(CONTEXT_MENU_CHANNEL, buildContextMenuPayload(params));
  });
}

export function runContextAction(wc: WebContents | null | undefined, action: string, extra?: string): void {
  if (!wc) return;
  switch (action) {
    case "undo": wc.undo(); break;
    case "redo": wc.redo(); break;
    case "cut": wc.cut(); break;
    case "copy": wc.copy(); break;
    case "paste": wc.paste(); break;
    case "selectAll": wc.selectAll(); break;
    case "openLink":
      if (extra && /^https?:\/\//.test(extra)) void shell.openExternal(extra);
      break;
    case "copyLink":
      if (extra) clipboard.writeText(extra);
      break;
    case "print":
      wc.print({ silent: false, printBackground: true });
      break;
    default: break;
  }
}
