// Lumina · PDF 阅读器右键菜单（中文 + 图标 + 主题 token）
import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Copy, Link2, StickyNote, Sparkles, Quote, Languages, Search,
  Plus, Minus, Maximize, ScanLine, RotateCw, RotateCcw,
  ChevronLeft, ChevronRight, Bookmark, BookmarkMinus, Download, Printer,
  Highlighter, Crop, Moon, Expand, Hand, FileDown, FileText, ClipboardList,
} from "lucide-react";
import { truncateLabel } from "../reader-selection.js";

const CSS = `
.lf-ctx{position:fixed;z-index:2000;background:var(--raise);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow-lg);padding:6px;min-width:212px;max-width:min(280px,calc(100vw - 16px));animation:lfCtxIn .14s ease}
@keyframes lfCtxIn{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}
.lf-ctx-item{display:flex;align-items:center;gap:10px;width:100%;border:none;background:transparent;border-radius:9px;padding:8px 10px;cursor:pointer;font-family:inherit;font-size:13px;color:var(--ink2);text-align:left;line-height:1.25}
.lf-ctx-item:hover:not(:disabled){background:var(--surf2);color:var(--ink)}
.lf-ctx-item:disabled{opacity:.38;cursor:default}
.lf-ctx-ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--ink3);flex-shrink:0}
.lf-ctx-item:hover:not(:disabled) .lf-ctx-ico{color:var(--gold)}
.lf-ctx-lbl{flex:1;min-width:0}
.lf-ctx-kbd{margin-left:auto;font-family:'Space Mono',monospace;font-size:10px;color:var(--ink4);letter-spacing:.02em;white-space:nowrap}
.lf-ctx-sep{height:1px;background:var(--line);margin:4px 6px}
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

function buildItems(menu, platform) {
  const mod = modKey(platform);
  const items = [];
  if (menu.kind === "selection" && menu.selection) {
    const short = truncateLabel(menu.selection.text, 20);
    items.push(
      { id: "copy", label: "复制", icon: Copy, kbd: `${mod}+C` },
      { id: "copyCite", label: "复制带页码引用", icon: Link2 },
      { type: "sep" },
      { id: "hl-yellow", label: "高亮 · 黄", icon: () => <HlSwatch color="yellow" /> },
      { id: "hl-green", label: "高亮 · 绿", icon: () => <HlSwatch color="green" /> },
      { id: "hl-pink", label: "高亮 · 粉", icon: () => <HlSwatch color="pink" /> },
      { id: "note", label: "添加便签", icon: StickyNote },
      { type: "sep" },
      { id: "explain", label: "解释", icon: Sparkles },
      { id: "writingObs", label: "写作观察", icon: Quote },
      { id: "translate", label: "翻译所选", icon: Languages },
      { type: "sep" },
      { id: "findSelection", label: `在文档中查找「${short}」`, icon: Search, lblClass: "trunc" },
    );
    return items;
  }

  items.push(
    { id: "zoomIn", label: "放大", icon: Plus, kbd: `${mod}+` },
    { id: "zoomOut", label: "缩小", icon: Minus, kbd: `${mod}+-` },
    { id: "fitWidth", label: "适配宽度", icon: Maximize, kbd: `${mod}+0` },
    { id: "actualSize", label: "实际大小 100%", icon: ScanLine },
    { id: "fitPage", label: "适配整页", icon: FileText },
    { type: "sep" },
    { id: "rotateCw", label: "顺时针旋转", icon: RotateCw, kbd: "R" },
    { id: "rotateCcw", label: "逆时针旋转", icon: RotateCcw, kbd: "Shift+R" },
    { type: "sep" },
    { id: "prevPage", label: "上一页", icon: ChevronLeft, disabled: menu.page <= 1, kbd: "←" },
    { id: "nextPage", label: "下一页", icon: ChevronRight, disabled: menu.page >= menu.numPages, kbd: "→" },
    { type: "sep" },
    menu.hasBookmark
      ? { id: "removeBookmark", label: "移除本页书签", icon: BookmarkMinus }
      : { id: "addBookmark", label: "收藏本页", icon: Bookmark },
    { id: "copyPage", label: `复制页码（第 ${menu.page} 页）`, icon: ClipboardList },
    { type: "sep" },
    { id: "find", label: "页内查找", icon: Search, kbd: `${mod}+F` },
    { id: "snip", label: "截图分析", icon: Crop },
    { id: "openNotes", label: menu.annoCount > 0 ? `批注面板（${menu.annoCount} 条）` : "批注面板", icon: Highlighter },
    { id: "openAssist", label: "阅读助手", icon: Sparkles },
    { type: "sep" },
    { id: "toggleNight", label: menu.night ? "关闭夜读反色" : "夜读反色", icon: Moon },
    { id: "toggleFocus", label: menu.focus ? "退出专注模式" : "专注模式", icon: Expand },
    { id: "toggleHand", label: menu.hand ? "关闭抓手平移" : "抓手平移", icon: Hand },
    { type: "sep" },
    { id: "download", label: "下载 PDF", icon: Download },
    { id: "print", label: "打印", icon: Printer, kbd: `${mod}+P` },
  );
  if (menu.annoCount > 0) {
    items.push({ type: "sep" });
    items.push({ id: "exportPdf", label: "导出带注释 PDF", icon: FileDown });
    items.push({ id: "exportMd", label: "导出批注 Markdown", icon: FileDown });
  }
  return items;
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
  }, [menu.x, menu.y, menu.kind]);

  const items = buildItems(menu, platform);

  const run = (item) => {
    if (item.disabled) return;
    onAction(item.id);
    onClose();
  };

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
        {items.map((item, i) => item.type === "sep" ? (
          <div key={"s" + i} className="lf-ctx-sep" role="separator" />
        ) : (
          <button
            key={item.id + i}
            type="button"
            role="menuitem"
            className="lf-ctx-item"
            disabled={!!item.disabled}
            onClick={() => run(item)}
          >
            <span className="lf-ctx-ico">
              {typeof item.icon === "function" ? item.icon() : React.createElement(item.icon, { size: 16, strokeWidth: 2 })}
            </span>
            <span className={"lf-ctx-lbl" + (item.lblClass ? " " + item.lblClass : "")}>{item.label}</span>
            {item.kbd ? <span className="lf-ctx-kbd">{item.kbd}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}
