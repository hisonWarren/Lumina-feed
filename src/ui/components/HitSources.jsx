// HitSources v3 · 多源合并状态（非全库总数）
import React, { useState } from "react";
import { RefreshCw } from "lucide-react";

const LABEL = {
  semanticscholar: "Semantic Scholar", europepmc: "Europe PMC", openalex: "OpenAlex",
  pubmed: "PubMed", crossref: "Crossref", arxiv: "arXiv", biorxiv: "bioRxiv", medrxiv: "medRxiv",
  doaj: "DOAJ", datacite: "DataCite", core: "CORE", lens: "Lens.org", hal: "HAL",
  osf: "OSF", zenodo: "Zenodo", openaire: "OpenAIRE", dblp: "DBLP",
  libgen: "LibGen", annas: "Anna's Archive", scihub: "Sci-Hub", resolve: "标识符解析",
};
const label = (id) => LABEL[id] || id;

const RETRYABLE = new Set(["libgen", "annas", "semanticscholar", "zenodo", "openaire", "biorxiv", "medrxiv", "core", "lens", "crossref", "arxiv", "openalex"]);

function formatSrcCount(count, sourceLimit) {
  if (!count) return "";
  const cap = sourceLimit > 0 && count >= sourceLimit;
  return cap ? `${sourceLimit}+` : String(count);
}

export default function HitSources({ perSource, mergedCount, sourceLimit = 25, needsKey, onRetrySource, retryingSource }) {
  const [open, setOpen] = useState(false);
  if (!perSource || !Object.keys(perSource).length) return null;

  const entries = Object.entries(perSource);
  const hit = [], empty = [], failed = [], timeout = [], unconfigured = [];
  for (const [src, stt] of entries) {
    if (needsKey && needsKey[src]) { unconfigured.push(src); continue; }
    if (!stt) { empty.push(src); continue; }
    if (stt.ok && stt.count > 0) hit.push(src);
    else if (stt.ok) empty.push(src);
    else if (/timeout/i.test(String(stt.error || ""))) timeout.push(src);
    else failed.push(src);
  }

  const issues = timeout.length + failed.length + unconfigured.length;
  const summary = [
    `${entries.length + unconfigured.length} 个数据库`,
    mergedCount != null ? `合并 ${mergedCount} 篇` : null,
    issues ? `${issues} 个需关注` : null,
  ].filter(Boolean);

  const RetryBtn = ({ src }) => {
    if (!onRetrySource || !RETRYABLE.has(src)) return null;
    const busy = retryingSource === src;
    return (
      <button type="button" className="lf-src-retry" disabled={busy} onClick={() => onRetrySource(src)} title="仅重试此源">
        <RefreshCw size={11} className={busy ? "ff-spin" : ""} /> {busy ? "重试中" : "重试"}
      </button>
    );
  };

  const row = (s, cls, text) => (
    <span key={s} className={"lf-src " + cls}>
      <i className="dot" />{label(s)}{text ? ` · ${text}` : ""}
      {(cls.includes("warn") || cls === "lf-src zero") && <RetryBtn src={s} />}
    </span>
  );

  return (
    <div className="lf-sources lf-sources-v2">
      <button type="button" className="lf-src-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="lbl">来源</span>
        <span className="sum">{summary.join(" · ")}</span>
        <span className="caret">{open ? "收起 ▴" : "展开 ▾"}</span>
      </button>
      {open && (
        <div className="lf-src-detail">
          {hit.map((s) => (
            <span key={s} className="lf-src">
              <i className="dot ok" />{label(s)}{perSource[s]?.count ? ` · ${formatSrcCount(perSource[s].count, sourceLimit)}` : ""}
            </span>
          ))}
          {empty.map((s) => row(s, "zero", "无匹配"))}
          {timeout.map((s) => row(s, "warn", "超时"))}
          {failed.map((s) => row(s, "warn", "失败"))}
          {unconfigured.map((s) => row(s, "need", "需配置 Key"))}
        </div>
      )}
    </div>
  );
}
