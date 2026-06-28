// finish-all · 标题匹配置信芯片
import React from "react";

export default function MatchBadge({ kind }) {
  if (kind !== "title_exact" && kind !== "title_strong") return null;
  const label = kind === "title_exact" ? "标题高度匹配 · 你大概率在找这篇" : "标题匹配";
  return <div className="lf-match">✓ {label}</div>;
}
