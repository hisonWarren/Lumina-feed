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
  if (isGarbledTitle(s)) return 0;
  if (s.startsWith("import-")) return 1;
  if (/\.pdf$/i.test(s)) return 2;
  if (isJournalMastheadLine(s)) return 3;
  const words = s.split(/\s+/).filter(Boolean).length;
  if (words >= 4 && s.length >= 24) return 12;
  if (words >= 2 && s.length >= 12) return 8;
  return 5;
}

/** PDF /Title 被当成 Latin-1 读出的 UTF-16 乱码（þÿ、□、字母间空格） */
export function isGarbledTitle(title: string): boolean {
  const s = String(title || "");
  if (!s) return true;
  if (s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) return true;
  if (/^þÿ/.test(s) || /\uFEFF/.test(s)) return true;
  if (/[\uFFFD□]/.test(s)) return true;
  if (s.length > 16) {
    const spaces = (s.match(/ /g) || []).length;
    if (spaces / s.length > 0.22 && /[A-Za-z]/.test(s)) return true;
  }
  return false;
}

function decodePdfTitleBytes(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(raw.subarray(2));
  }
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(raw.subarray(2));
  }
  if (raw.length >= 4 && raw.length % 2 === 0 && raw[0] === 0 && raw[2] === 0) {
    return new TextDecoder("utf-16be").decode(raw);
  }
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b === 0x5c && i + 1 < raw.length) {
      const esc = raw[++i];
      if (esc === 0x6e) out += "\n";
      else if (esc === 0x72) out += "\r";
      else if (esc === 0x74) out += "\t";
      else if (esc === 0x62) out += "\b";
      else if (esc === 0x66) out += "\f";
      else out += String.fromCharCode(esc);
    } else if (b >= 0x20 && b !== 0x7f) {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

function readPdfParenPayload(buf: Buffer, openIdx: number): Buffer | null {
  if (buf[openIdx] !== 0x28) return null;
  const bytes: number[] = [];
  let i = openIdx + 1;
  let depth = 1;
  while (i < buf.length && depth > 0) {
    const b = buf[i];
    if (b === 0x28) { depth++; bytes.push(b); i++; continue; }
    if (b === 0x29) { depth--; if (depth === 0) break; bytes.push(b); i++; continue; }
    if (b === 0x5c && i + 1 < buf.length) { bytes.push(b, buf[i + 1]); i += 2; continue; }
    bytes.push(b);
    i++;
  }
  return Buffer.from(bytes);
}

function normalizeTitleCandidate(t: string | null): string | null {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 280 || isGarbledTitle(s) || isJournalMastheadLine(s)) return null;
  return s;
}

/** 从 PDF 二进制 Info 字典读取 /Title（不跑全文抽取） */
export function titleFromPdfInfo(bytes: Uint8Array): string | null {
  try {
    const buf = Buffer.from(bytes);
    const latin = buf.toString("latin1");
    const idx = latin.indexOf("/Title");
    if (idx < 0) return null;
    const tail = latin.slice(idx);
    const hexM = tail.match(/^\/Title\s*<([0-9A-Fa-f\s]+)>/);
    if (hexM) {
      const hex = hexM[1].replace(/\s/g, "");
      if (hex.length >= 4 && hex.length % 2 === 0) {
        return normalizeTitleCandidate(decodePdfTitleBytes(Buffer.from(hex, "hex")));
      }
    }
    const parenM = tail.match(/^\/Title\s*\(/);
    if (parenM) {
      const openIdx = idx + parenM[0].length - 1;
      const payload = readPdfParenPayload(buf, openIdx);
      if (payload?.length) return normalizeTitleCandidate(decodePdfTitleBytes(payload));
    }
    return null;
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

/** 综合：文件名 → PDF Info Title（导入路径不做全文抽取，保持响应快） */
export function resolveImportTitle(bytes: Uint8Array, filenameFallback: string): string {
  const fromFile = titleFromFilename(filenameFallback);
  const fromInfo = titleFromPdfInfo(bytes);
  const candidates = [fromFile, fromInfo].filter(Boolean) as string[];
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
