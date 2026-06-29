// Lumina Feed · 共享 UI 工具（patch: find_fetch 前置）
export function isDoi(s) {
  const t = normDoi(s);
  return /^10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+$/i.test(t);
}

/** 标识符输入（DOI / PMID / PMCID / arXiv）— 不走字段标签后缀 */
export function isIdentifierLike(s) {
  const t = String(s || "").trim();
  if (!t) return false;
  if (isDoi(t)) return true;
  if (/^pmid:?\s*\d{4,9}$/i.test(t)) return true;
  if (/pubmed\.ncbi\.nlm\.nih\.gov\/\d{4,9}/i.test(t)) return true;
  if (/^(?:pmc:?|pmcid:?)?PMC\d+$/i.test(t)) return true;
  if (/arxiv\.org\/(?:abs|pdf)\/\d{4}\.\d{4,5}(?:v\d+)?/i.test(t)) return true;
  if (/^(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(t)) return true;
  return false;
}

/** 标识符类型短标签（UI） */
export function identifierLabel(s) {
  const t = String(s || "").trim();
  if (isDoi(t)) return "DOI";
  if (/^pmid:?\s*\d{4,9}$/i.test(t) || /pubmed\.ncbi\.nlm\.nih\.gov\/\d{4,9}/i.test(t)) return "PMID";
  if (/^(?:pmc:?|pmcid:?)?PMC\d+$/i.test(t)) return "PMCID";
  if (/arxiv/i.test(t) || /^\d{4}\.\d{4,5}/.test(t)) return "arXiv";
  return null;
}

export function normDoi(s) {
  return String(s || "").trim()
    .replace(/^doi:?\s*/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/\s+$/, "");
}

export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
