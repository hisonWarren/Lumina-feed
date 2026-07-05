// Lumina · PDF 阅读器右键菜单（中文 + 图标；空白区精简 · 选区保留批注/AI 核心项）
import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Copy, Link2, StickyNote, Sparkles, Languages, Search, TextSelect,
  ChevronLeft, ChevronRight as ChevronRightNav, Bookmark, BookmarkMinus, Printer,
  Undo2,
} from "lucide-react";
import { truncateLabel } from "../reader-selection.js";

const CSS = `
.lf-ctx{position:fixed;z-index:2000;background:var(--raise);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow-lg);padding:6px;min-width:240px;max-width:min(360px,calc(100vw - 16px));animation:lfCtxIn .14s ease;display:flex;flex-direction:column;overflow:hidden}
@keyframes lfCtxIn{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}
.lf-ctx-item{display:flex;align-items:center;gap:10px;width:100%;border:none;background:transparent;border-radius:9px;padding:8px 10px;cursor:pointer;font-family:inherit;font-size:13px;color:var(--ink2);text-align:left;line-height:1.25;overflow:hidden;min-width:0}
.lf-ctx-item:hover:not(:disabled){background:var(--surf2);color:var(--ink)}
.lf-ctx-item:disabled{opacity:.38;cursor:default}
.lf-ctx-ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--ink3);flex-shrink:0}
.lf-ctx-item:hover:not(:disabled) .lf-ctx-ico{color:var(--gold)}
.lf-ctx-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lf-ctx-kbd{margin-left:8px;font-family:'Space Mono',monospace;font-size:10px;color:var(--ink4);letter-spacing:.02em;white-space:nowrap;flex-shrink:0}
.lf-ctx-sep{height:1px;background:var(--line);margin:4px 6px;flex-shrink:0}
.lf-ctx-group-h{font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink4);padding:8px 10px 3px;flex-shrink:0}
.lf-ctx-more{color:var(--ink3);font-size:12.5px}
.lf-ctx-more .lf-ctx-ico{color:var(--ink4)}
@media (prefers-reduced-motion: reduce){ .lf-ctx{animation:none} }
.lf-ctx.rd-ctx{position:fixed;z-index:2100}
.lf-ctx-hl{width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,.35);flex-shrink:0}
.lf-ctx-hl.yellow{background:rgba(245,210,70,.95)}
.lf-ctx-hl.green{background:rgba(120,220,120,.95)}
.lf-ctx-hl.pink{background:rgba(255,150,180,.95)}
`;

function modKey(platform) {
  return platform === "darwin" ? "⌘" : "Ctrl";
}

function HlSwatch({ color }) {
  return <span className={"lf-ctx-hl " + color} aria-hidden />;
}

function renderIcon(Icon, size = 16) {
  if (typeof Icon !== "function") return null;
  try {
    const out = Icon();
    if (out && out.$$typeof) return out;
  } catch (_) { /* lucide component */ }
  return React.createElement(Icon, { size, strokeWidth: 2 });
}

// 空白区：只保留顶栏没有的捷径（打印）+ 高频动作；缩放/旋转/显示/导出等见顶栏
function buildBlankPrimary(menu, mod) {
  const items = [
    { id: "prevPage", label: "上一页", icon: ChevronLeft, disabled: menu.page <= 1, kbd: "←" },
    { id: "nextPage", label: "下一页", icon: ChevronRightNav, disabled: menu.page >= menu.numPages, kbd: "→" },
    { type: "sep" },
    menu.hasBookmark
      ? { id: "removeBookmark", label: "移除本页书签", icon: BookmarkMinus }
      : { id: "addBookmark", label: "收藏本页", icon: Bookmark },
    { type: "sep" },
    { id: "find", label: "页内查找", icon: Search, kbd: `${mod}+F` },
    { id: "print", label: "打印", icon: Printer, kbd: `${mod}+P` },
  ];
  if (menu.canUndoAnno) {
    items.push(
      { type: "sep" },
      { id: "undoAnno", label: "撤销上一批注", icon: Undo2, kbd: `${mod}+Z` },
    );
  }
  return items;
}

function buildBlankMore() {
  return [];
}

function buildTranslationPrimary(menu, mod) {
  const items = [
    { id: "tpCopy", label: "复制", icon: Copy, kbd: `${mod}+C` },
    { id: "tpCopyCite", label: "复制带页码引用", icon: Link2 },
  ];
  if (menu.canCopyBilingual) {
    items.push({ id: "tpCopyBilingual", label: "复制中英对照", icon: Languages });
  }
  items.push(
    { type: "sep" },
    { id: "tpSelectAll", label: "全选", icon: TextSelect, kbd: `${mod}+A` },
  );
  return items;
}

function buildTranslationBlank(menu, mod) {
  return [
    { id: "tpCopyPage", label: "复制本页译文", icon: Copy },
    { type: "sep" },
    { id: "tpSelectAll", label: "全选本页", icon: TextSelect, kbd: `${mod}+A` },
  ];
}

function buildSelectionPrimary(menu, mod) {
  const short = truncateLabel(menu.selection?.text || "", 20);
  const items = [
    { id: "copy", label: "复制", icon: Copy, kbd: `${mod}+C` },
    { id: "copyCite", label: "复制带页码引用", icon: Link2 },
    { type: "sep" },
    { id: "hl-yellow", label: "高亮 · 黄", icon: () => <HlSwatch color="yellow" /> },
    { id: "hl-green", label: "高亮 · 绿", icon: () => <HlSwatch color="green" /> },
    { id: "hl-pink", label: "高亮 · 粉", icon: () => <HlSwatch color="pink" /> },
    { id: "note", label: "添加便签", icon: StickyNote },
    { type: "sep" },
    { id: "explain", label: "解释", icon: Sparkles },
    { id: "translate", label: "翻译所选", icon: Languages },
    { type: "sep" },
    { id: "findSelection", label: `在文档中查找「${short}」`, icon: Search },
  ];
  if (menu.canUndoAnno) {
    items.push(
      { type: "sep" },
      { id: "undoAnno", label: "撤销上一批注", icon: Undo2, kbd: `${mod}+Z` },
    );
  }
  return items;
}

function buildMenus(menu, platform) {
  const mod = modKey(platform);
  if (menu.kind === "translation" && menu.selection) {
    return { primary: buildTranslationPrimary(menu, mod), more: [] };
  }
  if (menu.kind === "translationBlank") {
    return { primary: buildTranslationBlank(menu, mod), more: [] };
  }
  if (menu.kind === "selection" && menu.selection) {
    return { primary: buildSelectionPrimary(menu, mod), more: [] };
  }
  return { primary: buildBlankPrimary(menu, mod), more: buildBlankMore() };
}

function CtxRow({ item, onAction, onClose }) {
  if (item.type === "sep") {
    return <div className="lf-ctx-sep" role="separator" />;
  }
  if (item.type === "group") {
    return <div className="lf-ctx-group-h" role="presentation">{item.label}</div>;
  }

  const run = () => {
    if (item.disabled) return;
    onAction(item.id);
    onClose();
  };

  return (
    <button
      type="button"
      role="menuitem"
      className="lf-ctx-item"
      disabled={!!item.disabled}
      onClick={run}
    >
      <span className="lf-ctx-ico">{renderIcon(item.icon)}</span>
      <span className="lf-ctx-lbl" title={item.label}>{item.label}</span>
      {item.kbd ? <span className="lf-ctx-kbd">{item.kbd}</span> : null}
    </button>
  );
}

export default function ReaderContextMenu({ menu, platform, onAction, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [menu.x, menu.y, menu.kind, menu.canUndoAnno, menu.annoCount]);

  const { primary } = buildMenus(menu, platform);

  const stopInside = (e) => { e.stopPropagation(); };

  return (
    <>
      <style>{CSS}</style>
      <div
        ref={ref}
        className="lf-ctx rd-ctx"
        role="menu"
        aria-label="阅读器菜单"
        style={{ left: pos.left + "px", top: pos.top + "px" }}
        onMouseDown={stopInside}
        onPointerDown={stopInside}
        onContextMenu={(e) => e.preventDefault()}
      >
        {primary.map((item, i) => (
          <CtxRow key={"p" + (item.id || item.type) + i} item={item} onAction={onAction} onClose={onClose} />
        ))}
      </div>
    </>
  );
}
