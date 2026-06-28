// P4 · 卡片多源贡献徽章（来自 versions[] 去重合并）
import React from "react";

const LABEL = {
  pubmed: "PubMed", europepmc: "Europe PMC", crossref: "Crossref", openalex: "OpenAlex",
  arxiv: "arXiv", biorxiv: "bioRxiv", medrxiv: "medRxiv", semanticscholar: "S2",
  doaj: "DOAJ", datacite: "DataCite", core: "CORE", lens: "Lens", hal: "HAL",
  osf: "OSF", zenodo: "Zenodo", openaire: "OpenAIRE", dblp: "DBLP",
  libgen: "LibGen", annas: "Anna's", scihub: "Sci-Hub", resolve: "解析",
};

function srcLabel(id) {
  if (!id) return null;
  const k = String(id).toLowerCase();
  if (LABEL[k]) return LABEL[k];
  if (/libgen/.test(k)) return "LibGen";
  if (/annas/.test(k)) return "Anna's";
  return id.length > 12 ? id.slice(0, 10) + "…" : id;
}

/** @param {{ paper: object; sources?: string[] }} props */
export default function SourceChips({ paper, sources }) {
  const list = sources?.length
    ? sources
    : [...new Set((paper?.versions || []).map((v) => v.source).filter(Boolean))];
  const uniq = [...new Set(list.map((s) => String(s).split("_")[0].toLowerCase()))];
  if (uniq.length <= 1) return null;
  return (
    <div className="lf-src-chips">
      {uniq.slice(0, 6).map((s) => (
        <span key={s} className="lf-src-chip" title={`贡献源：${s}`}>{srcLabel(s)}</span>
      ))}
      {uniq.length > 6 ? <span className="lf-src-chip more">+{uniq.length - 6}</span> : null}
    </div>
  );
}
