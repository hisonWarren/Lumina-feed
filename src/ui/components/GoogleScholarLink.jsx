// open-sources · Google Scholar 外链兜底（修 review F13：诚实兜底，放结果区末尾，不喧宾夺主）。
// 仅 shell:openExternal 打开 GS 检索页；不爬、不解析、不入库（红线/范围护栏）。
import React from "react";

export default function GoogleScholarLink({ query, onOpen, count }) {
  if (!query) return null;
  const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
  return (
    <div className="lf-gs">
      <span className="lf-gs-t">
        {count ? "没找到想要的那篇？" : "开放源未命中。"}开放学术源不含 Google Scholar 索引与商业库内容——
      </span>
      <button className="lf-gs-link" onClick={() => onOpen && onOpen(url)}>在 Google Scholar 中打开 ↗</button>
    </div>
  );
}
