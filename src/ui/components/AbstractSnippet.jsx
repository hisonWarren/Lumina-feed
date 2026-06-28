// finish-all · 摘要折叠
import React, { useState } from "react";

export default function AbstractSnippet({ text }) {
  const [open, setOpen] = useState(false);
  const abs = (text || "").trim();
  if (!abs) {
    return (
      <div className="lf-abs empty">
        <div className="body">该来源未提供摘要 — 获取全文或 AI 总结后可补全。</div>
      </div>
    );
  }
  return (
    <div className={"lf-abs" + (open ? "" : " clamped")}>
      <div className="body">{abs}</div>
      <button type="button" className="toggle" onClick={() => setOpen((o) => !o)}>{open ? "收起" : "展开摘要"}</button>
    </div>
  );
}
