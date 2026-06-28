// 简报 · 「为何出现」一行（规则层，非 AI 纳入判断）
import React from "react";

function snippet(text, terms, max = 120) {
  if (!text || !terms?.length) return "";
  const low = text.toLowerCase();
  for (const t of terms) {
    const i = low.indexOf(String(t).toLowerCase());
    if (i >= 0) {
      const start = Math.max(0, i - 24);
      const chunk = text.slice(start, start + max);
      return (start > 0 ? "…" : "") + chunk + (start + max < text.length ? "…" : "");
    }
  }
  return text.slice(0, max) + (text.length > max ? "…" : "");
}

export default function DigestMatchWhy({ paper, query, subLabels }) {
  const terms = paper.matched?.length ? paper.matched : [];
  const qTerms = query ? [...new Set(String(query).toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]{2,}/g) || [])].filter((w) => {
    const hay = `${paper.title || ""} ${paper.abstract || ""}`.toLowerCase();
    return hay.includes(w);
  }).slice(0, 4) : [];
  const show = terms.length ? terms : qTerms;
  const snip = snippet(paper.abstract || paper.title || "", show);
  return (
    <div className="dg-why">
      {show.length > 0 && (
        <span className="dg-why-k">
          匹配{show.slice(0, 3).map((t, i) => <mark key={i}>{t}</mark>)}
        </span>
      )}
      {snip && <span className="dg-why-s">{snip}</span>}
      {subLabels && subLabels.length > 1 && (
        <span className="dg-why-multi">同时匹配：{subLabels.join(" · ")}</span>
      )}
    </div>
  );
}
