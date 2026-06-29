// 简报 · 「为何出现」一行（规则层，非 AI 纳入判断）
import React from "react";

export default function DigestMatchWhy({ paper, query, subLabels }) {
  const terms = paper.matched?.length ? paper.matched : [];
  const qTerms = query ? [...new Set(String(query).toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]{2,}/g) || [])].filter((w) => {
    const hay = `${paper.title || ""} ${paper.abstract || ""}`.toLowerCase();
    return hay.includes(w);
  }).slice(0, 4) : [];
  const show = terms.length ? terms : qTerms;
  return (
    <div className="dg-why">
      {show.length > 0 && (
        <span className="dg-why-k">
          匹配{show.slice(0, 3).map((t, i) => <mark key={i}>{t}</mark>)}
        </span>
      )}
      {subLabels && subLabels.length > 1 && (
        <span className="dg-why-multi">同时匹配：{subLabels.join(" · ")}</span>
      )}
    </div>
  );
}
