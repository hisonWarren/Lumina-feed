// 简报 · 摘要展示（默认 3 行截断 + 展开/收起）
import React, { useState } from "react";

export default function DigestAbstract({ abstract, className = "" }) {
  const [open, setOpen] = useState(false);
  const text = String(abstract || "").trim();
  if (!text) return null;
  return (
    <div className={"dg-abs" + (open ? " open" : "") + (className ? ` ${className}` : "")}>
      <span className="dg-abs-label">摘要</span>
      <p className="dg-abs-text">{text}</p>
      <button
        type="button"
        className="dg-abs-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "收起摘要" : "展开摘要"}
      </button>
    </div>
  );
}
