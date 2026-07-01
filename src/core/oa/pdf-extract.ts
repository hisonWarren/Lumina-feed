// lumina-feed · M3 PDF 文本抽取
// 两条路径：① extractWithPdfjs（生产,处理复杂排版/CID 字体,注入 pdfjs-dist 的 getDocument）
//          ② extractPdfTextBasic（零依赖,Node 内置 zlib;处理 FlateDecode 文本流,作回退/沙箱可跑）
import * as zlib from "node:zlib";

// ── ② 内置最小抽取器 ──
function decodePdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, g: string) => {
    switch (g) {
      case "n": return "\n"; case "r": return "\r"; case "t": return "\t";
      case "b": return "\b"; case "f": return "\f"; case "(": return "("; case ")": return ")"; case "\\": return "\\";
      default: return String.fromCharCode(parseInt(g, 8));
    }
  });
}

function textFromContentStream(content: string): string {
  const out: string[] = [];
  // (str) Tj  |  [ (a) n (b) ] TJ
  const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj|\[((?:[^\[\]]|\\.)*)\]\s*TJ|(T\*|Td|TD)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) out.push(decodePdfString(m[1]));
    else if (m[2] !== undefined) {
      const parts = [...m[2].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((x) => decodePdfString(x[1]));
      out.push(parts.join(""));
    } else if (m[3]) out.push("\n"); // 行/段定位 → 换行
  }
  return out.join("");
}

/** 纯 Node 抽取：扫描 stream…endstream，FlateDecode 则 inflate，再提取 Tj/TJ 文本。 */
export function extractPdfTextBasic(
  bytes: Uint8Array,
  opts?: { maxScanBytes?: number; maxOutputChars?: number },
): string {
  const maxScan = opts?.maxScanBytes ?? bytes.byteLength;
  const maxOut = opts?.maxOutputChars;
  const buf = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, maxScan)));
  const latin = buf.toString("latin1");
  let text = "";
  let idx = 0;
  while (true) {
    const sIdx = latin.indexOf("stream", idx);
    if (sIdx < 0) break;
    if (latin.slice(sIdx - 3, sIdx) === "end") { idx = sIdx + 6; continue; } // 跳过 endstream 误匹配
    const dictStart = latin.lastIndexOf("<<", sIdx);
    const dict = dictStart >= 0 ? latin.slice(dictStart, sIdx) : "";
    let dataStart = sIdx + "stream".length;
    if (latin[dataStart] === "\r") dataStart++;
    if (latin[dataStart] === "\n") dataStart++;
    const eIdx = latin.indexOf("endstream", dataStart);
    if (eIdx < 0) break;
    let end = eIdx;
    while (end > dataStart && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--; // 去尾部换行
    const raw = buf.subarray(dataStart, end);
    idx = eIdx + "endstream".length;

    let content = "";
    if (/\/FlateDecode/.test(dict)) {
      try { content = zlib.inflateSync(raw).toString("latin1"); }
      catch { try { content = zlib.inflateRawSync(raw).toString("latin1"); } catch { content = ""; } }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|Image)/.test(dict)) {
      content = raw.toString("latin1"); // 未压缩文本流
    }
    if (content) {
      const t = textFromContentStream(content);
      if (t.trim()) text += t + "\n";
      if (maxOut && text.length >= maxOut) break;
    }
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** 异步版内置抽取：每处理若干 stream 让出事件循环，避免 FTS 阻塞主进程 IPC。 */
export async function extractPdfTextBasicAsync(
  bytes: Uint8Array,
  opts?: { maxScanBytes?: number; maxOutputChars?: number; yieldEvery?: number },
): Promise<string> {
  const maxScan = opts?.maxScanBytes ?? bytes.byteLength;
  const maxOut = opts?.maxOutputChars;
  const yieldEvery = opts?.yieldEvery ?? 4;
  const buf = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, maxScan)));
  const latin = buf.toString("latin1");
  let text = "";
  let idx = 0;
  let streamCount = 0;
  while (true) {
    const sIdx = latin.indexOf("stream", idx);
    if (sIdx < 0) break;
    if (latin.slice(sIdx - 3, sIdx) === "end") { idx = sIdx + 6; continue; }
    const dictStart = latin.lastIndexOf("<<", sIdx);
    const dict = dictStart >= 0 ? latin.slice(dictStart, sIdx) : "";
    let dataStart = sIdx + "stream".length;
    if (latin[dataStart] === "\r") dataStart++;
    if (latin[dataStart] === "\n") dataStart++;
    const eIdx = latin.indexOf("endstream", dataStart);
    if (eIdx < 0) break;
    let end = eIdx;
    while (end > dataStart && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--;
    const raw = buf.subarray(dataStart, end);
    idx = eIdx + "endstream".length;
    streamCount++;

    let content = "";
    if (/\/FlateDecode/.test(dict)) {
      try { content = zlib.inflateSync(raw).toString("latin1"); }
      catch { try { content = zlib.inflateRawSync(raw).toString("latin1"); } catch { content = ""; } }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|Image)/.test(dict)) {
      content = raw.toString("latin1");
    }
    if (content) {
      const t = textFromContentStream(content);
      if (t.trim()) text += t + "\n";
      if (maxOut && text.length >= maxOut) break;
    }
    if (streamCount % yieldEvery === 0) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// ── ① pdfjs 包装（生产；loadDocument 注入 pdfjs-dist 的 getDocument(...).promise） ──
export interface PdfTextItem { str: string }
export interface PdfPageLike { getTextContent(): Promise<{ items: PdfTextItem[] }> }
export interface PdfDocLike { numPages: number; getPage(n: number): Promise<PdfPageLike> }
export type PdfjsLoad = (data: Uint8Array) => Promise<PdfDocLike>;

export async function extractWithPdfjs(bytes: Uint8Array, load: PdfjsLoad, maxPages = 50): Promise<string> {
  const doc = await load(bytes);
  const pages: string[] = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => it.str).join(" "));
  }
  return pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
}

export interface ExtractDeps { pdfjsLoad?: PdfjsLoad; maxPages?: number }

/** 统一入口：有 pdfjs 用 pdfjs，否则用内置抽取器（并在 pdfjs 抽取过短时回退）。 */
export async function extractText(bytes: Uint8Array, deps: ExtractDeps = {}): Promise<string> {
  const pageCap = deps.maxPages;
  const scanCap = pageCap ? Math.min(bytes.byteLength, 450_000) : undefined;
  if (deps.pdfjsLoad) {
    try {
      const t = await extractWithPdfjs(bytes, deps.pdfjsLoad, pageCap);
      if (t && t.replace(/\s+/g, "").length >= 200) return t;
    } catch { /* 落到内置抽取器 */ }
  }
  return extractPdfTextBasicAsync(bytes, { maxScanBytes: scanCap, yieldEvery: 3 });
}
