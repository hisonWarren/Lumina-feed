// locate · 标识符解析（A 车道入口）— DOI / PMID / PMCID / arXiv
import { normDoi } from "../dedupe.ts";

export type IdentifierKind = "doi" | "pmid" | "pmcid" | "arxiv" | "text";

export interface ParsedIdentifier {
  kind: IdentifierKind;
  value: string;
  /** 归一化后的主键值（小写 DOI、纯数字 PMID 等） */
  normalized: string;
}

const DOI_RE = /^10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+$/i;
const ARXIV_RE = /^(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$/i;

export function isDoiLike(raw: string): boolean {
  const t = String(raw || "").trim();
  if (/^https?:\/\/(dx\.)?doi\.org\//i.test(t)) return true;
  return DOI_RE.test(t);
}

export function parseIdentifier(raw: string): ParsedIdentifier | null {
  const t = String(raw || "").trim();
  if (!t) return null;

  const doiUrl = t.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\S+)$/i);
  if (doiUrl) {
    const d = normDoi(doiUrl[1]);
    return d ? { kind: "doi", value: t, normalized: d } : null;
  }
  if (DOI_RE.test(t)) {
    const d = normDoi(t);
    return d ? { kind: "doi", value: t, normalized: d } : null;
  }

  const pmidUrl = t.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{4,9})/i);
  if (pmidUrl) return { kind: "pmid", value: t, normalized: pmidUrl[1] };

  const pmidTag = t.match(/^pmid:?\s*(\d{4,9})$/i);
  if (pmidTag) return { kind: "pmid", value: t, normalized: pmidTag[1] };

  const pmc = t.match(/^(?:pmc:?|pmcid:?)?(PMC\d+)$/i);
  if (pmc) return { kind: "pmcid", value: t, normalized: pmc[1].toUpperCase() };

  const arxivUrl = t.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (arxivUrl) {
    const id = arxivUrl[1].replace(/v\d+$/, "");
    return { kind: "arxiv", value: t, normalized: id };
  }

  const arxivBare = ARXIV_RE.exec(t);
  if (arxivBare) return { kind: "arxiv", value: t, normalized: arxivBare[1] };

  return null;
}

/** UI 用：识别输入类型（含 text） */
export function classifyInput(raw: string): IdentifierKind {
  return parseIdentifier(raw)?.kind ?? "text";
}
