// finish-all · 预印本/撤稿/OA 徽章（信息非筛选）
import React from "react";

const OA = {
  gold: ["oa-gold", "金色 OA"],
  green: ["oa-green", "绿色 OA"],
  hybrid: ["oa-green", "混合 OA"],
  bronze: ["oa-green", "青铜 OA"],
  open: ["oa-green", "开放获取"],
};

export default function BadgeRow({ paper }) {
  if (!paper) return null;
  const b = [];
  if (paper.retracted) b.push(["retracted", "已撤稿"]);
  if (paper.preprint || paper.isPreprint) b.push(["preprint", "预印本 · 未经同行评议"]);
  const oaKey = paper.oaStatus || (paper.oa && paper.oa !== "closed" ? paper.oa : null);
  const oa = oaKey ? OA[oaKey] || (paper.oa === "gold" ? OA.gold : paper.oa === "green" ? OA.green : null) : null;
  if (oa) b.push(oa);
  if ((paper.peer || paper.peerReviewed) && !paper.preprint && !paper.isPreprint) b.push(["peer", "已同行评议"]);
  if (!b.length) return null;
  return (
    <div className="lf-badges">
      {b.map(([c, t]) => <span key={c} className={"lf-badge " + c}>{t}</span>)}
    </div>
  );
}
