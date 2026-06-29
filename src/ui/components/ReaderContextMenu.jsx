// Lumina · PDF 阅读器右键菜单（中文 + 图标 + 主题 token；空白区折叠子菜单）
import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Copy, Link2, StickyNote, Sparkles, Quote, Languages, Search,
  Plus, Minus, Maximize, ScanLine, RotateCw, RotateCcw, ChevronRight,
  ChevronLeft, ChevronRight as ChevronRightNav, Bookmark, BookmarkMinus, Download, Printer,
  Highlighter, Crop, Moon, Expand, Hand, FileDown, FileText, ClipboardList, Undo2,
  Layers, FolderOpen,
} from "lucide-react";
import { truncateLabel } from "../reader-selection.js";

const CSS = `
.lf-ctx{position:fixed;z-index:2000;background:var(--raise);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow-lg);padding:6px;min-width:212px;max-width:min(280px,calc(100vw - 16px));animation:lfCtxIn .14s ease;display:flex;flex-direction:column}
.lf-ctx-scroll{max-height:min(72vh,520px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
@keyframes lfCtxIn{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}
.lf-ctx-item{display:flex;align-items:center;gap:10px;width:100%;border:none;background:transparent;border-radius:9px;padding:8px 10px;cursor:pointer;font-family:inherit;font-size:13px;color:var(--ink2);text-align:left;line-height:1.25}
.lf-ctx-item:hover:not(:disabled){background:var(--surf2);color:var(--ink)}
.lf-ctx-item:disabled{opacity:.38;cursor:default}
.lf-ctx-ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--ink3);flex-shrink:0}
.lf-ctx-item:hover:not(:disabled) .lf-ctx-ico{color:var(--gold)}
.lf-ctx-lbl{flex:1;min-width:0}
.lf-ctx-kbd{margin-left:auto;font-family:'Space Mono',monospace;font-size:10px;color:var(--ink4);letter-spacing:.02em;white-space:nowrap}
.lf-ctx-sep{height:1px;background:var(--line);margin:4px 6px;flex-shrink:0}
.lf-ctx-sub{position:relative}
.lf-ctx-sub:hover>.lf-ctx-fly,.lf-ctx-sub.open>.lf-ctx-fly{opacity:1;pointer-events:auto;visibility:visible}
.lf-ctx-fly{position:absolute;left:calc(100% + 4px);top:-6px;min-width:196px;background:var(--raise);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow-lg);padding:6px;opacity:0;pointer-events:none;visibility:hidden;z-index:2}
.lf-ctx-fly.left{left:auto;right:calc(100% + 4px)}
.lf-ctx-chev{margin-left:6px;color:var(--ink4);flex-shrink:0}
@media (prefers-reduced-motion: reduce){ .lf-ctx{animation:none} }
.lf-ctx.rd-ctx{position:fixed;z-index:2100;min-width:220px;max-width:min(300px,calc(100vw - 16px))}
.lf-ctx-hl{width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,.35);flex-shrink:0}
.lf-ctx-hl.yellow{background:rgba(245,210,70,.95)}
.lf-ctx-hl.green{background:rgba(120,220,120,.95)}
.lf-ctx-hl.pink{background:rgba(255,150,180,.95)}
.lf-ctx-lbl.trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
  } catch (_) { /* lucide component — use createElement below */ }
  return React.createElement(Icon, { size, strokeWidth: 2 });
}

function buildBlankItems(menu, platform) {
  const mod = modKey(platform);
  const items = [
    { id: "zoomIn", label: "放大", icon: Plus, kbd: `${mod}+` },
    { id: "zoomOut", label: "缩小", icon: Minus, kbd: `${mod}+-` },
    {
      type: "submenu", id: "zoomPresets", label: "缩放与适配", icon: Maximize,
      children: [
        { id: "fitWidth", label: "适配宽度", icon: Maximize, kbd: `${mod}+0` },
        { id: "actualSize", label: "实际大小 100%", icon: ScanLine },
        { id: "fitPage", label: "适配整页", icon: FileText },
      ],
    },
    {
      type: "submenu", id: "rotateGroup", label: "旋转", icon: RotateCw,
      children: [
        { id: "rotateCw", label: "顺时针旋转", icon: RotateCw, kbd: "R" },
        { id: "rotateCcw", label: "逆时针旋转", icon: RotateCcw, kbd: "Shift+R" },
      ],
    },
    { type: "sep" },
    { id: "prevPage", label: "上一页", icon: ChevronLeft, disabled: menu.page <= 1, kbd: "←" },
    { id: "nextPage", label: "下一页", icon: ChevronRightNav, disabled: menu.page >= menu.numPages, kbd: "→" },
    { type: "sep" },
    menu.hasBookmark
      ? { id: "removeBookmark", label: "移除本页书签", icon: BookmarkMinus }
      : { id: "addBookmark", label: "收藏本页", icon: Bookmark },
    { id: "copyPage", label: `复制页码（第 ${menu.page} 页）`, icon: ClipboardList },
    { type: "sep" },
    { id: "find", label: "页内查找", icon: Search, kbd: `${mod}+F` },
    { id: "snip", label: "截图分析", icon: Crop },
    {
      id: "undoAnno", label: "撤销上一批注", icon: Undo2,
      disabled: !menu.canUndoAnno, kbd: `${mod}+Z`,
    },
    { type: "sep" },
    {
      type: "submenu", id: "displayTools", label: "显示与工具", icon: Layers,
      children: [
        { id: "toggleNight", label: menu.night ? "关闭夜读反色" : "夜读反色", icon: Moon },
        { id: "toggleFocus", label: menu.focus ? "退出专注模式" : "专注模式", icon: Expand },
        { id: "toggleHand", label: menu.hand ? "关闭抓手平移" : "抓手平移", icon: Hand },
        { type: "sep" },
        { id: "openNotes", label: menu.annoCount > 0 ? `批注面板（${menu.annoCount} 条）` : "批注面板", icon: Highlighter },
        { id: "openAssist", label: "阅读助手", icon: Sparkles },
      ],
    },
    {
      type: "submenu", id: "fileGroup", label: "文件", icon: FolderOpen,
      children: [
        { id: "download", label: "下载 PDF", icon: Download },
        { id: "print", label: "打印", icon: Printer, kbd: `${mod}+P` },
        ...(menu.annoCount > 0 ? [
          { type: "sep" },
          { id: "exportPdf", label: "导出带注释 PDF", icon: FileDown },
          { id: "exportMd", label: "导出批注 Markdown", icon: FileDown },
        ] : []),
      ],
    },
  ];
  return items;
}

function buildItems(menu, platform) {
  const mod = modKey(platform);
  if (menu.kind === "selection" && menu.selection) {
    const short = truncateLabel(menu.selection.text, 20);
    const items = [
      { id: "copy", label: "复制", icon: Copy, kbd: `${mod}+C` },
      { id: "copyCite", label: "复制带页码引用", icon: Link2 },
      { type: "sep" },
      { id: "hl-yellow", label: "高亮 · 黄", icon: () => <HlSwatch color="yellow" /> },
      { id: "hl-green", label: "高亮 · 绿", icon: () => <HlSwatch color="green" /> },
      { id: "hl-pink", label: "高亮 · 粉", icon: () => <HlSwatch color="pink" /> },
      { id: "note", label: "添加便签", icon: StickyNote },
    ];
    if (menu.canUndoAnno) {
      items.push(
        { type: "sep" },
        { id: "undoAnno", label: "撤销上一批注", icon: Undo2, kbd: `${mod}+Z` },
      );
    }
    items.push(
      { type: "sep" },
      { id: "explain", label: "解释", icon: Sparkles },
      { id: "writingObs", label: "写作观察", icon: Quote },
      { id: "translate", label: "翻译所选", icon: Languages },
      { type: "sep" },
      { id: "findSelection", label: `在文档中查找「${short}」`, icon: Search, lblClass: "trunc" },
    );
    return items;
  }
  return buildBlankItems(menu, platform);
}

function CtxRow({ item, onAction, onClose, depth = 0 }) {
  const subRef = useRef(null);
  const [flyLeft, setFlyLeft] = useState(false);

  useLayoutEffect(() => {
    if (item.type !== "submenu" || !subRef.current) return;
    const fly = subRef.current.querySelector(".lf-ctx-fly");
    if (!fly) return;
    const rect = fly.getBoundingClientRect();
    setFlyLeft(rect.right > window.innerWidth - 8);
  }, [item.type, item.id]);

  if (item.type === "sep") {
    return <div className="lf-ctx-sep" role="separator" />;
  }

  if (item.type === "submenu") {
    const runChild = (child) => {
      if (child.disabled || child.type === "sep") return;
      onAction(child.id);
      onClose();
    };
    return (
      <div className="lf-ctx-sub" ref={subRef}>
        <button type="button" role="menuitem" className="lf-ctx-item" aria-haspopup="true">
          <span className="lf-ctx-ico">{renderIcon(item.icon)}</span>
          <span className="lf-ctx-lbl">{item.label}</span>
          <ChevronRight size={14} className="lf-ctx-chev" aria-hidden />
        </button>
        <div className={"lf-ctx-fly" + (flyLeft ? " left" : "")} role="menu">
          {item.children.map((child, i) => child.type === "sep" ? (
            <div key={"cs" + i} className="lf-ctx-sep" role="separator" />
          ) : (
            <button
              key={child.id + i}
              type="button"
              role="menuitem"
              className="lf-ctx-item"
              disabled={!!child.disabled}
              onClick={() => runChild(child)}
            >
              <span className="lf-ctx-ico">{renderIcon(child.icon)}</span>
              <span className={"lf-ctx-lbl" + (child.lblClass ? " " + child.lblClass : "")}>{child.label}</span>
              {child.kbd ? <span className="lf-ctx-kbd">{child.kbd}</span> : null}
            </button>
          ))}
        </div>
      </div>
    );
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
      <span className={"lf-ctx-lbl" + (item.lblClass ? " " + item.lblClass : "")}>{item.label}</span>
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

  const items = buildItems(menu, platform);

  return (
    <>
      <style>{CSS}</style>
      <div
        ref={ref}
        className="lf-ctx rd-ctx"
        role="menu"
        aria-label="阅读器菜单"
        style={{ left: pos.left + "px", top: pos.top + "px" }}
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="lf-ctx-scroll">
          {items.map((item, i) => (
            <CtxRow key={(item.id || item.type) + i} item={item} onAction={onAction} onClose={onClose} />
          ))}
        </div>
      </div>
    </>
  );
}
