// Lumina Feed · 文献卡片徽章（OA 状态 + 全文来源）
import React from "react";
import { AlertTriangle } from "lucide-react";
import { oaStatusBadge } from "./fetch-meta.js";

const CONTAINER = { "ff-b": "ff-badges", "sd-b": "sd-badges", "dg-b": "dg-badges", "lib-b": "lib-badges" };

/** @param {{ p: object; fetchedMeta?: object|null; fetchingMeta?: object|null; badgePrefix?: string; compact?: boolean }} props */
export default function FetchBadges({ p, fetchedMeta, fetchingMeta, badgePrefix = "ff-b", compact = false }) {
  const bp = badgePrefix;
  const oa = oaStatusBadge(p.oa, fetchedMeta, bp, fetchingMeta);
  const ftCls = oa ? oa.cls : "";
  return (
    <span className={CONTAINER[bp] || "ff-badges"}>
      {p.retracted && <span className={bp + " " + bp + "-ret"}><AlertTriangle size={11} /> 已撤稿</span>}
      {p.preprint && <span className={bp + " " + bp + "-pre"}>预印本 · 未经同行评议</span>}
      {oa && <span className={bp + " " + ftCls} title={oa.title || undefined}>{oa.text}</span>}
      {!compact && p.type && <span className={bp}>{p.type}</span>}
      {!compact && (p.journal || p.year) && <span className={bp + " " + bp + "-yr"}>{p.journal || ""}{p.journal && p.year ? " · " : ""}{p.year || ""}</span>}
    </span>
  );
}
