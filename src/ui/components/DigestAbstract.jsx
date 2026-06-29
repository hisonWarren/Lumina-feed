// 简报 · 摘要展示（2–3 行 + 展开）
import React, { useState } from "react";

export default function DigestAbstract({ abstract }) {
  const [open, setOpen] = useState(false);
  const text = String(abstract || "").trim();
  if (!text) {
    return <div className="dg-abs dg-abs-empty">暂无摘要 · 仅标题与 metadata</div>;
  }
  const long = text.length > 180 || text.split(/\s+/).length > 35;
  return (
    <div className={"dg-abs" + (open ? " open" : "")}>
      <span className="dg-abs-label">摘要</span>
      <p className="dg-abs-text">{text}</p>
      {long && (
        <button type="button" className="dg-abs-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? "收起摘要" : "阅读摘要"}
        </button>
      )}
    </div>
  );
}
