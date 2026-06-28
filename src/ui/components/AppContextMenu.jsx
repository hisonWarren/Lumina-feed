// Lumina · 应用内右键菜单（中文 + 图标 + 主题 token，替代 Electron 原生英文菜单）
import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Undo2, Redo2, Scissors, Copy, ClipboardPaste, TextSelect,
  ExternalLink, Link2,
} from "lucide-react";

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
`;

function modKey(platform) {
  return platform === "darwin" ? "⌘" : "Ctrl";
}

function buildItems(payload, platform) {
  const mod = modKey(platform);
  const f = payload.editFlags || {};
  const items = [];
  if (payload.isEditable) {
    items.push(
      { id: "undo", label: "撤销", icon: Undo2, kbd: `${mod}+Z`, disabled: !f.canUndo },
      { id: "redo", label: "重做", icon: Redo2, kbd: platform === "darwin" ? `${mod}+Shift+Z` : `${mod}+Y`, disabled: !f.canRedo },
      { type: "sep" },
      { id: "cut", label: "剪切", icon: Scissors, kbd: `${mod}+X`, disabled: !f.canCut },
      { id: "copy", label: "复制", icon: Copy, kbd: `${mod}+C`, disabled: !f.canCopy },
      { id: "paste", label: "粘贴", icon: ClipboardPaste, kbd: `${mod}+V`, disabled: !f.canPaste },
      { type: "sep" },
      { id: "selectAll", label: "全选", icon: TextSelect, kbd: `${mod}+A`, disabled: !f.canSelectAll },
    );
  } else if ((payload.selectionText || "").trim()) {
    items.push({ id: "copy", label: "复制", icon: Copy, kbd: `${mod}+C`, disabled: !f.canCopy });
  } else if (payload.linkURL) {
    items.push(
      { id: "openLink", label: "打开链接", icon: ExternalLink, extra: payload.linkURL },
      { id: "copyLink", label: "复制链接", icon: Link2, kbd: `${mod}+C`, extra: payload.linkURL },
    );
  }
  return items;
}

export default function AppContextMenu({ payload, platform, onAction, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: payload.x, top: payload.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = payload.x;
    let top = payload.y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [payload.x, payload.y]);

  const items = buildItems(payload, platform);

  const run = (item) => {
    if (item.disabled) return;
    onAction(item.id, item.extra);
    onClose();
  };

  return (
    <>
      <style>{CSS}</style>
      <div
        ref={ref}
        className="lf-ctx"
        role="menu"
        aria-label="上下文菜单"
        style={{ left: pos.left + "px", top: pos.top + "px" }}
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
            <span className="lf-ctx-ico"><item.icon size={16} strokeWidth={2} /></span>
            <span className="lf-ctx-lbl">{item.label}</span>
            {item.kbd ? <span className="lf-ctx-kbd">{item.kbd}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}
