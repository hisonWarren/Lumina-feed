// finish-all · 引用复制 + 下载 .ris/.bib
import React, { useState } from "react";
import { STYLES, formatCitation } from "../cite.js";
import { bridge } from "../lumina-bridge.js";

export default function CitationActions({ paper, onToast, onClose }) {
  const [open, setOpen] = useState(false);
  const copy = (style) => {
    try {
      const t = formatCitation(style, paper);
      navigator.clipboard && navigator.clipboard.writeText(t);
      onToast && onToast("已复制 " + style.toUpperCase() + " 引用");
    } catch { /* noop */ }
    setOpen(false);
    onClose && onClose();
  };
  const dl = async (fmt) => {
    setOpen(false);
    try {
      const payload = {
        title: paper.title, authors: paper.authors, journal: paper.journal || paper.abbr,
        year: paper.year, doi: paper.doi, abstract: paper.abstract,
        isPreprint: paper.preprint || paper.isPreprint,
      };
      const r = await bridge.exportCitation([payload], fmt);
      if (r && r.ok) onToast && onToast("已保存 ." + fmt + " 文件");
      else if (r && r.reason === "canceled") { /* user canceled */ }
      else onToast && onToast("导出失败");
    } catch {
      onToast && onToast("导出失败");
    }
    onClose && onClose();
  };
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="ff-act" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>引用 ▾</button>
      {open && (
        <div className="lf-cite-menu open" onClick={(e) => e.stopPropagation()}>
          <div className="grp">复制为</div>
          <div className="lf-cite-styles">
            {STYLES.map(([id, label]) => (
              <button key={id} type="button" onClick={() => copy(id)}>{label}</button>
            ))}
          </div>
          <div className="grp">下载文件（导入文献管理器）</div>
          <button type="button" className="lf-dl" onClick={() => dl("ris")}>RIS<span className="ext">.ris · Zotero / EndNote</span></button>
          <button type="button" className="lf-dl" onClick={() => dl("bib")}>BibTeX<span className="ext">.bib · LaTeX</span></button>
        </div>
      )}
    </div>
  );
}
