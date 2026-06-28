// 简报 · 紧凑来源 chips（诚实披露，非数据库总数）
import React from "react";

const LABEL = {
  semanticscholar: "Semantic Scholar", europepmc: "Europe PMC", openalex: "OpenAlex",
  pubmed: "PubMed", crossref: "Crossref", arxiv: "arXiv", biorxiv: "bioRxiv", medrxiv: "medRxiv",
  doaj: "DOAJ", datacite: "DataCite", core: "CORE", lens: "Lens.org", hal: "HAL",
  osf: "OSF", zenodo: "Zenodo", openaire: "OpenAIRE", dblp: "DBLP",
};
const label = (id) => LABEL[id] || id;

export default function DigestSourceLine({ sources, perSource }) {
  const ids = sources?.length
    ? sources
    : perSource
      ? Object.keys(perSource).filter((k) => perSource[k]?.ok && (perSource[k]?.count ?? 0) > 0)
      : [];
  if (!ids.length) return null;
  return (
    <div className="dg-src" aria-label="命中来源">
      {ids.slice(0, 6).map((id) => (
        <span key={id} className="dg-src-chip">{label(id)}</span>
      ))}
      {ids.length > 6 && <span className="dg-src-more">+{ids.length - 6}</span>}
    </div>
  );
}
