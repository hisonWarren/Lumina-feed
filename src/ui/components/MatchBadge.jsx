// finish-all · 标题匹配置信芯片
import React from "react";

export default function MatchBadge({ kind, primary }) {
  if (kind !== "title_exact" && kind !== "title_strong" && !primary) return null;
  let label = "标题匹配";
  if (primary && kind === "title_exact") label = "就是这篇 · 标题完全一致";
  else if (primary && kind === "title_strong") label = "最可能这篇 · 标题高度相似";
  else if (kind === "title_exact") label = "标题完全一致";
  else if (kind === "title_strong") label = "标题高度匹配 · 检索词均在标题中";
  return <div className="lf-match">✓ {label}</div>;
}
