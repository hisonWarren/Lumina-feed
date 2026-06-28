// finish-all · 标题匹配置信芯片
import React from "react";

export default function MatchBadge({ kind, primary }) {
  if (kind !== "title_exact" && kind !== "title_strong" && !primary) return null;
  let label = "标题匹配";
  if (primary && kind === "title_exact") label = "就是这篇 · 标题完全匹配";
  else if (kind === "title_exact") label = "标题高度匹配 · 你大概率在找这篇";
  return <div className="lf-match">✓ {label}</div>;
}
