// open-sources · 检索深度开关（修 review F12：深度是检索时决策，应在检索栏旁，不埋设置）。
// 标准=每源 25；全面=每源 50（更多源、更慢）。选中态 = 实心 petrol（doc 03 §2）。
import React from "react";

export default function SearchDepthToggle({ value = "standard", onChange, busy }) {
  const opt = (id, label, hint) => (
    <button
      type="button"
      className={"lf-depth-opt" + (value === id ? " on" : "")}
      onClick={() => !busy && onChange && onChange(id)}
      aria-pressed={value === id}
      title={hint}
    >
      {label}
    </button>
  );
  return (
    <div className="lf-depth" role="group" aria-label="检索深度">
      {opt("standard", "标准", "每源约 25 条，更快")}
      {opt("full", "全面", "每源约 50 条，覆盖更广但更慢")}
      <span className="lf-depth-hint">{value === "full" ? "更多源 · 更慢" : "更快"}</span>
    </div>
  );
}
