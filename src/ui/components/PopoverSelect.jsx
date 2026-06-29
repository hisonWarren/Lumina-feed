// 自定义下拉：避免 Windows 原生 <select> 弹出项过紧；与 FindFetch 字段/排序菜单一致。
import React, { useState, useEffect, useId } from "react";
import { ChevronDown, Check } from "lucide-react";

const CSS = `
.pop-sel{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink3)}
.pop-sel-wrap{position:relative;display:inline-flex;align-items:center}
.pop-sel-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line2);background:var(--surf);color:var(--ink);border-radius:8px;padding:6px 10px;font-size:12px;font-family:inherit;cursor:pointer;outline:none;line-height:1.35}
.pop-sel-btn:hover,.pop-sel-btn.on{border-color:var(--gold);color:var(--gold)}
.pop-sel-btn:focus{border-color:var(--gold)}
.pop-sel-menu{position:absolute;top:calc(100% + 6px);z-index:25;min-width:148px;background:var(--raise,var(--surf));border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.16));padding:6px;display:flex;flex-direction:column;gap:3px}
.pop-sel-menu.right{right:0}
.pop-sel-menu.left{left:0}
.pop-sel-opt{display:flex;align-items:center;justify-content:space-between;gap:8px;border:none;background:transparent;color:var(--ink2);text-align:left;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;line-height:1.4;width:100%}
.pop-sel-opt:hover{background:var(--surf2);color:var(--gold)}
.pop-sel-opt.on{color:var(--gold);background:color-mix(in srgb,var(--gold) 10%,transparent)}
`;

export default function PopoverSelect({
  label,
  prefix,
  value,
  options,
  onChange,
  align = "right",
  ariaLabel,
  className = "",
  menuMinWidth,
}) {
  const [open, setOpen] = useState(false);
  const wrapCls = useId().replace(/:/g, "");
  const cur = options.find((o) => o.id === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => {
      if (!(e.target && e.target.closest && e.target.closest(`[data-pop-sel="${wrapCls}"]`))) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open, wrapCls]);

  return (
    <div className={"pop-sel " + className}>
      <style>{CSS}</style>
      {prefix}
      {label ? <span>{label}</span> : null}
      <div className="pop-sel-wrap" data-pop-sel={wrapCls}>
        <button
          type="button"
          className={"pop-sel-btn" + (open ? " on" : "")}
          aria-label={ariaLabel || label || "选择"}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {cur?.label}<ChevronDown size={12} />
        </button>
        {open && (
          <div
            className={"pop-sel-menu " + align}
            role="listbox"
            aria-label={ariaLabel || label || "选项"}
            style={menuMinWidth ? { minWidth: menuMinWidth } : undefined}
          >
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={value === o.id}
                className={"pop-sel-opt" + (value === o.id ? " on" : "")}
                onClick={() => { onChange(o.id); setOpen(false); }}
              >
                {o.label}{value === o.id ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
