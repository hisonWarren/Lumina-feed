// 取文失败提示（手动获取失败时弹窗，比 toast 更显眼）
import React, { useEffect } from "react";
import { LOGO_DATA_URI } from "../brand-logo.js";

const CSS = `
.lf-fetchfail-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:320;padding:20px}
.lf-fetchfail{width:100%;max-width:420px;background:var(--surf);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-lg,0 24px 60px rgba(20,22,26,.16));overflow:hidden}
.lf-fetchfail-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--surf2)}
.lf-fetchfail-logo{width:28px;height:28px;border-radius:8px;flex-shrink:0;object-fit:cover}
.lf-fetchfail-brand{font-family:'Source Serif 4',Georgia,serif;font-size:15px;font-weight:600;color:var(--ink)}
.lf-fetchfail-body{padding:18px}
.lf-fetchfail-title{margin:0 0 10px;font-size:15px;font-weight:600;color:var(--ink);line-height:1.45}
.lf-fetchfail-detail{margin:0;font-size:13px;line-height:1.65;color:var(--ink2);white-space:pre-wrap}
.lf-fetchfail-hint{margin:12px 0 0;padding:10px 12px;background:var(--surf2);border-radius:10px;font-size:12.5px;line-height:1.55;color:var(--ink3)}
.lf-fetchfail-foot{display:flex;justify-content:flex-end;padding:0 18px 16px}
.lf-fetchfail-btn{background:var(--gold);color:#fff;border:1px solid var(--gold);border-radius:10px;padding:8px 18px;font-size:13px;font-family:inherit;cursor:pointer}
.lf-fetchfail-btn:hover{background:var(--goldDim,#0B5F55);border-color:var(--goldDim,#0B5F55)}
`;

const FETCH_FAIL_HINT = "可尝试：核对 DOI · 在设置中配置联络邮箱（Unpaywall）· 经机构订阅访问 · 向作者索取 · 稍后重试。";

/** @param {{ open: boolean; paperTitle?: string; message: string; onClose: () => void }} props */
export default function FetchFailDialog({ open, paperTitle, message, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <style>{CSS}</style>
      <div className="lf-fetchfail-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="lf-fetchfail" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
          <div className="lf-fetchfail-head">
            <img className="lf-fetchfail-logo" src={LOGO_DATA_URI} alt="" width={28} height={28} />
            <span className="lf-fetchfail-brand">未能获取全文</span>
          </div>
          <div className="lf-fetchfail-body">
            {paperTitle ? <h2 className="lf-fetchfail-title">{paperTitle}</h2> : null}
            <p className="lf-fetchfail-detail">{message}</p>
            <p className="lf-fetchfail-hint">{FETCH_FAIL_HINT}</p>
          </div>
          <div className="lf-fetchfail-foot">
            <button type="button" className="lf-fetchfail-btn" onClick={onClose}>知道了</button>
          </div>
        </div>
      </div>
    </>
  );
}
