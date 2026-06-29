// Lumina Feed · PDF.js 封装 —— patch: reader_p1a + reader_p1b
// 纯 JS(ESM)，便于 node --check。真实渲染/worker/文本层仅真机可验。
// worker：同源 .mjs（构建时 build-electron 复制到 dist/），满足 CSP worker-src 'self'。
import * as pdfjsLib from "pdfjs-dist";

let _workerReady = false;
function ensureWorker() {
  if (_workerReady) return;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).href;
    _workerReady = true;
  } catch {
    /* 测试/非浏览器环境无 import.meta.url —— 渲染时真机再设 */
  }
}

/** 打开 PDF。source: { data: ArrayBuffer } | { url: string } → pdfDocument */
export async function openPdf(source) {
  ensureWorker();
  const params = source && source.data ? { data: source.data } : { url: (source && source.url) || "" };
  params.isEvalSupported = false; // CSP：不依赖 eval
  const task = pdfjsLib.getDocument(params);
  return task.promise;
}

/** 渲染某页到 canvas（按 devicePixelRatio 提升清晰度）。返回 CSS 尺寸。 */
export async function renderPageToCanvas(doc, pageNum, canvas, opts) {
  const { scale = 1, rotation = 0 } = opts || {};
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale, rotation });
  const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";
  const renderContext = { canvasContext: ctx, viewport };
  if (ratio !== 1) renderContext.transform = [ratio, 0, 0, ratio, 0, 0];
  await page.render(renderContext).promise;
  return { width: viewport.width, height: viewport.height };
}

/** P5：把某页（或归一化 bbox 区域）高清渲染为 PNG dataURL，供视觉模型读图。bbox={x,y,w,h} 均为 0..1。 */
export async function renderRegion(doc, pageNum, bbox, opts) {
  const { scale = 2.5, rotation = 0 } = opts || {};
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale, rotation });
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.floor(viewport.width));
  cv.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvasContext: cv.getContext("2d"), viewport }).promise;
  if (!bbox) return cv.toDataURL("image/png");
  const x = Math.max(0, Math.floor(bbox.x * cv.width));
  const y = Math.max(0, Math.floor(bbox.y * cv.height));
  const w = Math.max(1, Math.min(cv.width - x, Math.floor(bbox.w * cv.width)));
  const h = Math.max(1, Math.min(cv.height - y, Math.floor(bbox.h * cv.height)));
  const crop = document.createElement("canvas");
  crop.width = w; crop.height = h;
  crop.getContext("2d").drawImage(cv, x, y, w, h, 0, 0, w, h);
  return crop.toDataURL("image/png");
}

/** P1b：渲染真实文本层到 container（可选择/可查找）。兼容 v4 TextLayer 类与旧 renderTextLayer。 */
export async function renderTextLayer(page, container, viewport) {
  if (!container) return null;
  container.innerHTML = "";
  container.style.setProperty("--scale-factor", String(viewport.scale || 1));
  container.style.width = Math.floor(viewport.width) + "px";
  container.style.height = Math.floor(viewport.height) + "px";
  const textContent = await page.getTextContent();
  // v4.0+：TextLayer 类
  if (typeof pdfjsLib.TextLayer === "function") {
    const tl = new pdfjsLib.TextLayer({ textContentSource: textContent, container, viewport });
    await tl.render();
    return tl;
  }
  // 旧版：renderTextLayer 函数
  if (typeof pdfjsLib.renderTextLayer === "function") {
    const task = pdfjsLib.renderTextLayer({ textContentSource: textContent, container, viewport });
    await (task && task.promise ? task.promise : task);
    return task;
  }
  return null;
}

/** P1b：取某页文本项字符串数组（供页内查找计数；与文本层 span 同源同序）。 */
export async function getPageStrings(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  const tc = await page.getTextContent();
  return (tc.items || []).map((it) => (it && it.str) || "");
}

/** 翻译取文：按版面 y 坐标去页眉页脚、合并行与段落（双换行分隔）。 */
export async function extractPageTextForTranslate(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const pageH = viewport.height;
  const tc = await page.getTextContent();
  const raw = (tc.items || [])
    .map((it) => {
      if (!it || !String(it.str || "").trim()) return null;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      return { str: String(it.str).trim(), x: tr[4] || 0, y: pageH - (tr[5] || 0) };
    })
    .filter(Boolean);
  if (!raw.length) return "";
  const topCut = pageH * 0.08;
  const botCut = pageH * 0.92;
  const body = raw.filter((l) => l.y > topCut && l.y < botCut);
  const lines = body.length ? body : raw;
  lines.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const grouped = [];
  for (const l of lines) {
    const last = grouped[grouped.length - 1];
    if (last && Math.abs(last.y - l.y) < 6) {
      last.parts.push(l);
      last.y = (last.y + l.y) / 2;
    } else grouped.push({ y: l.y, parts: [l] });
  }
  for (const g of grouped) {
    g.str = g.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ");
  }
  const paras = [];
  let buf = [];
  for (let i = 0; i < grouped.length; i++) {
    if (i > 0 && grouped[i].y - grouped[i - 1].y > 18) {
      if (buf.length) paras.push(buf.join(" "));
      buf = [];
    }
    buf.push(grouped[i].str);
  }
  if (buf.length) paras.push(buf.join(" "));
  return paras.join("\n\n");
}

/** 文档大纲（书签）。无则空数组。 */
export async function getOutline(doc) {
  try { return (await doc.getOutline()) || []; } catch { return []; }
}

/** P1b：大纲目的地 → 页码（1 基）。处理命名目的地与显式数组。 */
export async function destToPageNumber(doc, dest) {
  try {
    let d = dest;
    if (typeof d === "string") d = await doc.getDestination(d);
    if (!Array.isArray(d) || d.length === 0) return null;
    const ref = d[0];
    if (ref == null) return null;
    const idx = await doc.getPageIndex(ref);
    return idx + 1;
  } catch {
    return null;
  }
}

/** P2a：取全文逐页文本（供阅读助手 AI 总结/问答）。返回 [{page, text}]。 */
export async function getDocPages(doc) {
  const out = [];
  const n = (doc && doc.numPages) || 0;
  for (let p = 1; p <= n; p++) {
    try {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out.push({ page: p, text: (tc.items || []).map((i) => (i && i.str) || "").join(" ") });
    } catch { out.push({ page: p, text: "" }); }
  }
  return out;
}

/** P2a：把回答里的 [p.X] 拆成片段，供 UI 渲染可点击跳页（正则集中在 .js，避免 JSX 括号检查误判）。返回 [{t:"text"|"cite", v}]。 */
export function splitCites(text) {
  const s = text || "";
  const parts = [];
  const re = /\[p\.(\d+)\]/g;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ t: "text", v: s.slice(last, m.index) });
    parts.push({ t: "cite", v: parseInt(m[1], 10) });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ t: "text", v: s.slice(last) });
  return parts;
}

/** 自适应宽度的缩放系数：容器宽 / 页面 1x 宽。 */
export async function fitWidthScale(doc, pageNum, containerWidth, rotation) {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1, rotation: rotation || 0 });
  if (!vp.width) return 1;
  return Math.max(0.2, Math.min(4, (containerWidth - 24) / vp.width));
}
