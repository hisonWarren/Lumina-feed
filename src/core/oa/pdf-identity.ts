// lumina-feed · 下载 PDF 身份校验（DOI / 标题），防止备用库错配入库
import { normDoi, titleFingerprint } from "../dedupe.ts";
import { jaccard } from "../locate/enrich-metadata.ts";
import { extractPdfTextBasic } from "./pdf-extract.ts";
import type { PdfCandidate } from "./candidate.ts";
import type { Paper } from "../model.ts";

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
const TITLE_MATCH_MIN = 0.82;

export interface PdfIdentityExpect {
  doi?: string;
  title?: string;
}

export interface PdfIdentityResult {
  ok: boolean;
  reason?: "doi_mismatch" | "title_mismatch" | "no_identity_signal";
  foundDois?: string[];
  titleScore?: number;
}

export function extractDoisFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(DOI_RE)) {
    const d = normDoi(m[0]);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

export function titleMatchScore(expectedTitle: string, pdfText: string): number {
  const fp = titleFingerprint(expectedTitle);
  if (!fp || fp.length < 6) return 0;
  return jaccard(fp, titleFingerprint(pdfText.slice(0, 8000)));
}

/** 从 PDF 首屏文本校验 DOI / 标题是否与目标文献一致。 */
export function verifyPdfIdentity(bytes: Uint8Array, expect: PdfIdentityExpect): PdfIdentityResult {
  if (!expect.doi && !expect.title?.trim()) return { ok: true };

  const text = extractPdfTextBasic(bytes, { maxOutputChars: 14_000 }).slice(0, 12_000);
  if (!text.replace(/\s+/g, "").length) return { ok: true };

  const foundDois = extractDoisFromText(text);
  const expDoi = normDoi(expect.doi);

  if (expDoi) {
    if (foundDois.some((d) => d === expDoi)) return { ok: true, foundDois };
    if (foundDois.length) return { ok: false, reason: "doi_mismatch", foundDois };
  }

  if (expect.title?.trim()) {
    const titleScore = titleMatchScore(expect.title, text);
    if (titleScore >= TITLE_MATCH_MIN) return { ok: true, titleScore, foundDois };
    return {
      ok: false,
      reason: foundDois.length ? "doi_mismatch" : "title_mismatch",
      foundDois,
      titleScore,
    };
  }

  if (expDoi) return { ok: false, reason: "no_identity_signal", foundDois };
  return { ok: true };
}

export function urlImpliesDoi(url: string, doi?: string): boolean {
  const d = normDoi(doi);
  if (!d) return false;
  const u = url.toLowerCase();
  return u.includes(d) || u.includes(encodeURIComponent(d).toLowerCase());
}

/** 备用库 / Sci-Hub 必须校验；出版商 URL 已含 DOI 时可跳过；OSF 官方 download 直链可信。 */
export function shouldVerifyPdfIdentity(cand: PdfCandidate, paper: Paper): boolean {
  if (cand.kind === "scihub") return true;
  if (/libgen|annas/.test(String(cand.source || "").toLowerCase())) return true;
  if (paper.doi && cand.kind === "url" && urlImpliesDoi(cand.url, paper.doi)) return false;
  if (cand.kind === "url" && String(cand.source) === "osf_download") return false;
  if (cand.kind === "url" && /osf\.io\/[a-z0-9]+\/download/i.test(cand.url)) return false;
  if (cand.kind === "url" && /(biorxiv|medrxiv)\.org\/content\/10\.(1101|64898)\/.+\.full\.pdf/i.test(cand.url)) return false;
  return !!(paper.doi || paper.title?.trim());
}
