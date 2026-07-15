// lumina-feed · 下载 PDF 身份校验（DOI / 标题），防止备用库错配入库
import { normDoi, titleFingerprint } from "../dedupe.ts";
import { jaccard } from "../locate/enrich-metadata.ts";
import { extractPdfTextBasic } from "./pdf-extract.ts";
import type { PdfCandidate } from "./candidate.ts";
import type { Paper } from "../model.ts";

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
const TITLE_MATCH_MIN = 0.82;
/** 足够像 DOI 后缀（避免裁剪过度） */
const DOI_CORE_RE = /^10\.\d{4,9}\/[a-z0-9][-._;()/:a-z0-9]*$/i;

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

/**
 * PDF 文本层常把 DOI 与后文标题粘在一起：`…0114Perceptionof…`。
 * 贪婪 DOI_RE 会吞掉标题，导致「找到错误 DOI」误杀正确全文。
 */
export function sanitizeExtractedDoi(raw: string): string | undefined {
  let d = normDoi(raw);
  if (!d) return undefined;
  // normDoi 后全小写：数字后紧跟 ≥4 个字母 → 多半是正文粘连（…0114perception…）
  d = d.replace(/(\d)[a-z]{4,}.*$/, "$1");
  // 去掉尾部标点
  d = d.replace(/[.,;:>\]}>]+$/g, "");
  if (!DOI_CORE_RE.test(d)) return undefined;
  return d;
}

/** 期望 DOI 与抽取 DOI 是否同一标识（含粘连后缀兼容）。 */
export function doisReferSame(expected: string | undefined, found: string | undefined): boolean {
  const a = normDoi(expected);
  const b = sanitizeExtractedDoi(found || "") || normDoi(found);
  if (!a || !b) return false;
  if (a === b) return true;
  // 抽取过长：期望为真 DOI 前缀，后缀是粘上的英文字母
  if (b.startsWith(a) && /^[A-Za-z]/.test(b.slice(a.length))) return true;
  if (a.startsWith(b) && b.length >= 16) return true;
  return false;
}

export function extractDoisFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(DOI_RE)) {
    const d = sanitizeExtractedDoi(m[0]) || normDoi(m[0]);
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
    if (foundDois.some((d) => doisReferSame(expDoi, d))) return { ok: true, foundDois };
    // 仅当抽到的 DOI「明确是另一篇」且无标题可依时才硬拒；
    // 粘连误抽 / 参考文献 DOI 先交给标题，避免误杀 Sci-Hub 正确全文。
    const foreign = foundDois.filter((d) => !doisReferSame(expDoi, d));
    const strongForeign = foreign.some((d) => {
      const ea = expDoi.split("/");
      const fa = d.split("/");
      return ea[0] === fa[0] && ea[1] && fa[1]
        && !fa[1].startsWith(ea[1].slice(0, Math.min(8, ea[1].length)))
        && !ea[1].startsWith(fa[1].slice(0, 8));
    });
    if (strongForeign && !expect.title?.trim()) {
      return { ok: false, reason: "doi_mismatch", foundDois };
    }
  }

  if (expect.title?.trim()) {
    const titleScore = titleMatchScore(expect.title, text);
    if (titleScore >= TITLE_MATCH_MIN) return { ok: true, titleScore, foundDois };
    if (expDoi && foundDois.length && foundDois.every((d) => !doisReferSame(expDoi, d))) {
      return { ok: false, reason: "doi_mismatch", foundDois, titleScore };
    }
    return {
      ok: false,
      reason: "title_mismatch",
      foundDois,
      titleScore,
    };
  }

  if (expDoi) {
    // 期望 DOI 未出现、也没有强冲突 → 文本层不可靠时放行
    if (!foundDois.length) return { ok: true, foundDois };
    return { ok: false, reason: "doi_mismatch", foundDois };
  }
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
