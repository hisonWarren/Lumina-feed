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

/** 粘贴容错：去空白、引号；10.xxxx_suffix → 10.xxxx/suffix（文件名式 DOI） */
export function coerceDoiCandidate(raw: string): string | null {
  let t = String(raw || "").trim();
  if (!t) return null;
  t = t.replace(/^["'<\[]+|["'>\]]+$/g, "").trim();
  t = t.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  t = t.replace(/^doi:\s*/i, "");
  t = t.replace(/\s+/g, "");
  // Liberated filename forms: 10.1016_Sxxxx → 10.1016/Sxxxx（仅在尚无 slash 时）
  if (/^10\.\d{4,9}_/i.test(t) && !t.includes("/")) {
    t = t.replace(/^(10\.\d{4,9})_+/i, "$1/");
  }
  if (!DOI_RE.test(t)) return null;
  return normDoi(t) ?? null;
}

export function isDoiLike(raw: string): boolean {
  const t = String(raw || "").trim();
  if (/^https?:\/\/(dx\.)?doi\.org\//i.test(t)) return true;
  if (DOI_RE.test(t)) return true;
  return !!coerceDoiCandidate(t);
}

export function parseIdentifier(raw: string): ParsedIdentifier | null {
  const t = String(raw || "").trim();
  if (!t) return null;

  const doiUrl = t.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\S+)$/i);
  if (doiUrl) {
    const d = coerceDoiCandidate(doiUrl[1]) || normDoi(doiUrl[1].replace(/\s+/g, ""));
    return d ? { kind: "doi", value: t, normalized: d } : null;
  }

  const doiTag = t.match(/^doi:?\s*(10\.\S+)$/i);
  if (doiTag) {
    const d = coerceDoiCandidate(doiTag[1]) || normDoi(doiTag[1].replace(/\s+/g, ""));
    return d ? { kind: "doi", value: t, normalized: d } : null;
  }

  if (DOI_RE.test(t)) {
    const d = normDoi(t);
    return d ? { kind: "doi", value: t, normalized: d } : null;
  }

  const coerced = coerceDoiCandidate(t);
  if (coerced) return { kind: "doi", value: t, normalized: coerced };

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
