// 检索广度（检索栏 + 设置 · 通用）
import React from "react";
import { SEARCH_DEPTH_META, sourceLimitFor } from "../search-depth.js";

export default function SearchDepthToggle({ value = "standard", onChange, busy }) {
  const limit = sourceLimitFor(value);
  const opt = (id) => {
    const m = SEARCH_DEPTH_META[id] || SEARCH_DEPTH_META.standard;
    return (
      <button
        type="button"
        className={"lf-depth-opt" + (value === id ? " on" : "")}
        onClick={() => !busy && onChange && onChange(id)}
        aria-pressed={value === id}
        title={m.hint}
      >
        {m.label}
      </button>
    );
  };
  return (
    <div className="lf-depth" role="group" aria-label="检索广度" title="控制每个开放数据库返回的最大条数（快/广）">
      {opt("standard")}
      {opt("full")}
      <span className="lf-depth-hint" title={SEARCH_DEPTH_META[value]?.hint || SEARCH_DEPTH_META.standard.hint}>
        各源上限 {limit}
      </span>
    </div>
  );
}
