// Lumina Feed · 应用内确认框（替代 window.confirm，带品牌 logo）
import React, { useEffect } from "react";
import { LOGO_DATA_URI } from "../brand-logo.js";

const CSS = `
.lf-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:300;padding:20px}
.lf-confirm{width:100%;max-width:400px;background:var(--surf);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-lg,0 24px 60px rgba(20,22,26,.16));overflow:hidden}
.lf-confirm-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--surf2)}
.lf-confirm-logo{width:28px;height:28px;border-radius:8px;flex-shrink:0;object-fit:cover;box-shadow:0 2px 8px rgba(20,22,26,.12)}
.lf-confirm-brand{font-family:'Source Serif 4',Georgia,serif;font-size:15px;font-weight:600;color:var(--ink);line-height:1.2}
.lf-confirm-body{padding:18px 18px 6px}
.lf-confirm-title{margin:0 0 8px;font-size:15px;font-weight:600;color:var(--ink);line-height:1.45}
.lf-confirm-detail{margin:0;font-size:13px;line-height:1.6;color:var(--ink2);white-space:pre-wrap}
.lf-confirm-foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 18px 16px}
.lf-confirm-btn{border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:10px;padding:8px 16px;font-size:13px;font-family:inherit;cursor:pointer}
.lf-confirm-btn:hover{border-color:var(--line2);color:var(--ink);background:var(--surf2)}
.lf-confirm-btn.primary{background:var(--gold);color:#fff;border-color:var(--gold)}
.lf-confirm-btn.primary:hover{background:var(--goldDim, #0B5F55);border-color:var(--goldDim, #0B5F55)}
.lf-confirm-btn.danger{background:var(--danger,#BC3B2B);color:#fff;border-color:var(--danger,#BC3B2B)}
.lf-confirm-btn.danger:hover{filter:brightness(.94)}
`;

/** @param {{ open: boolean; title: string; detail?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }} props */
export default function ConfirmDialog({
  open,
  title,
  detail = "",
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <>
      <style>{CSS}</style>
      <div className="lf-confirm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
        <div className="lf-confirm" role="alertdialog" aria-modal="true" aria-labelledby="lf-confirm-title" onMouseDown={(e) => e.stopPropagation()}>
          <div className="lf-confirm-head">
            <img className="lf-confirm-logo" src={LOGO_DATA_URI} alt="" width={28} height={28} />
            <span className="lf-confirm-brand">Lumina Feed</span>
          </div>
          <div className="lf-confirm-body">
            <h2 id="lf-confirm-title" className="lf-confirm-title">{title}</h2>
            {detail ? <p className="lf-confirm-detail">{detail}</p> : null}
          </div>
          <div className="lf-confirm-foot">
            <button type="button" className="lf-confirm-btn" onClick={onCancel}>{cancelLabel}</button>
            <button type="button" className={"lf-confirm-btn " + (danger ? "danger" : "primary")} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </>
  );
}
