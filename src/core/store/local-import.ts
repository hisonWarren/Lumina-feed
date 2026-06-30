// 本地 PDF → 工作集导入（内容哈希身份 · 稳定 paperId）
import { createHash } from "node:crypto";
import path from "node:path";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 仅含安全字符，可落盘为 encodeURIComponent(paperId).pdf */
export function paperIdFromContentHash(hashHex: string): string {
  const h = String(hashHex || "").replace(/[^a-f0-9]/gi, "").slice(0, 40);
  if (!h) throw new Error("empty hash");
  return `import-${h}`;
}

export function titleFromFilename(name: string): string {
  const base = path.basename(String(name || "document.pdf"), ".pdf");
  const t = base.replace(/[_-]+/g, " ").trim();
  return t || "未命名 PDF";
}

/** 期刊页眉/卷期行（非论文题名）—— Nature Neuroscience | Volume 26 | August 等 */
export function isJournalMastheadLine(line: string): boolean {
  const s = String(line || "").trim();
  if (!s || s.length < 8) return true;
  if (/[\uFFFD□]/.test(s) && /vol/i.test(s)) return true;
  if (/\|\s*(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(s)) return true;
  if (/\b(volume|vol\.?|issue|supplement|pp\.)\b/i.test(s) && s.length < 120) return true;
  const journalOnly = /^(nature|science|cell|lancet|nejm|pnas|jama|bmj)\b/i.test(s) && !/\b(study|analysis|effect|association|robust|estimation)\b/i.test(s);
  if (journalOnly && s.length < 90) return true;
  if (/^(nature neuroscience|nature medicine|nature methods)\b/i.test(s)) return true;
  return false;
}

export function titleQualityScore(title: string): number {
  const s = String(title || "").trim();
  if (!s) return 0;
  if (s.startsWith("import-")) return 1;
  if (/\.pdf$/i.test(s)) return 2;
  if (isJournalMastheadLine(s)) return 3;
  const words = s.split(/\s+/).filter(Boolean).length;
  if (words >= 4 && s.length >= 24) return 12;
  if (words >= 2 && s.length >= 12) return 8;
  return 5;
}

/** 从 PDF 二进制 Info 字典读取 /Title（不依赖 pdfjs） */
export function titleFromPdfInfo(bytes: Uint8Array): string | null {
  try {
    const latin = Buffer.from(bytes).toString("latin1");
    const m = latin.match(/\/Title\s*\((?:\\.|[^\\)])*\)/) || latin.match(/\/Title\s*<([0-9A-Fa-f\s]+)>/);
    if (!m) return null;
    let raw = m[0];
    if (raw.includes("(")) {
      raw = raw.replace(/^\/Title\s*\(/, "").replace(/\)\s*$/, "");
      raw = raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_x, g: string) => {
        if (g === "n") return "\n";
        if (g === "r") return "\r";
        if (g === "t") return "\t";
        if (g === "b") return "\b";
        if (g === "f") return "\f";
        if (g === "(") return "(";
        if (g === ")") return ")";
        if (g === "\\") return "\\";
        return String.fromCharCode(parseInt(g, 8));
      });
    } else {
      const hex = m[1].replace(/\s/g, "");
      const chars: string[] = [];
      for (let i = 0; i + 3 < hex.length; i += 4) {
        const code = parseInt(hex.slice(i, i + 4), 16);
        if (!Number.isNaN(code)) chars.push(String.fromCharCode(code));
      }
      raw = chars.join("");
    }
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 8 || t.length > 280 || isJournalMastheadLine(t)) return null;
    return t;
  } catch {
    return null;
  }
}

/** 从全文抽取结果中挑选最像论文题名的行 */
export function pickTitleFromExtractedText(text: string, fallback: string): string {
  const lines = String(text || "").split(/\n/).map((s) => s.trim()).filter((s) => s.length >= 15 && s.length <= 280);
  const candidates = lines.filter((l) => !isJournalMastheadLine(l));
  let best = fallback;
  let bestScore = titleQualityScore(fallback);
  for (const line of candidates.slice(0, 40)) {
    const sc = titleQualityScore(line);
    if (sc > bestScore || (sc === bestScore && best === fallback)) { best = line; bestScore = sc; }
  }
  return best;
}

/** 综合：文件名 → PDF Info Title → 正文启发式 */
export function resolveImportTitle(bytes: Uint8Array, filenameFallback: string, extractedText?: string): string {
  const fromFile = titleFromFilename(filenameFallback);
  const fromInfo = titleFromPdfInfo(bytes);
  const candidates = [fromFile, fromInfo, extractedText ? pickTitleFromExtractedText(extractedText, fromFile) : null].filter(Boolean) as string[];
  let best = fromFile;
  let bestScore = 0;
  for (const c of candidates) {
    const sc = titleQualityScore(c);
    if (sc > bestScore) { best = c; bestScore = sc; }
  }
  return best;
}

export const IMPORT_PROVENANCE = "local_import";

export function importMapHashKey(hash: string): string {
  return `importmap:hash:${hash}`;
}

export function importMapPathKey(localPath: string): string {
  return `importmap:path:${localPath}`;
}
