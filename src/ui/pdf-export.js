// Lumina Feed · 批注导出 —— patch: reader_p3
// 渲染层用 pdf-lib 导出"带注释 PDF"，及笔记 Markdown。坐标：批注 rects 存"未缩放 PDF 点(原点左上)"，
// 导出时翻转 Y（pdf-lib 原点左下）。仅 rotation=0 的页对齐最稳（旋转导出留真机校核）。
import { PDFDocument, rgb } from "pdf-lib";

const COLOR_RGB = {
  yellow: [1, 0.9, 0.35], green: [0.6, 0.95, 0.6], pink: [1, 0.72, 0.82], blue: [0.6, 0.8, 1],
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function baseName(name) {
  const n = name || "document";
  const i = n.toLowerCase().lastIndexOf(".pdf");
  return i > 0 ? n.slice(0, i) : n;
}

/** 导出带高亮的 PDF（非破坏：基于原字节复制后绘制）。 */
export async function exportAnnotatedPdf(bytes, annotations, name) {
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  for (const a of (annotations || [])) {
    if (a.type !== "highlight" || !a.rects) continue;
    const pg = pages[(a.page || 1) - 1];
    if (!pg) continue;
    const H = pg.getHeight();
    const c = COLOR_RGB[a.color] || COLOR_RGB.yellow;
    for (const r of a.rects) {
      pg.drawRectangle({ x: r.x, y: H - r.y - r.h, width: r.w, height: r.h, color: rgb(c[0], c[1], c[2]), opacity: 0.35 });
    }
  }
  const out = await pdf.save();
  downloadBlob(new Blob([out], { type: "application/pdf" }), baseName(name) + ".annotated.pdf");
}

/** 导出笔记 Markdown（按页分组，含锚定文本与批注）。 */
export function exportNotesMarkdown(annotations, name) {
  const lines = ["# 批注 · " + (name || "document"), ""];
  const byPage = {};
  for (const a of (annotations || [])) { const p = a.page || 1; (byPage[p] = byPage[p] || []).push(a); }
  Object.keys(byPage).map(Number).sort((x, y) => x - y).forEach((p) => {
    lines.push("## 第 " + p + " 页", "");
    for (const a of byPage[p]) {
      const tag = a.type === "note" ? "📝 便签" : "🖍 高亮";
      if (a.anchoredText) lines.push("- " + tag + "：「" + String(a.anchoredText).slice(0, 240) + "」");
      else lines.push("- " + tag);
      if (a.note) lines.push("  - 批注：" + a.note);
    }
    lines.push("");
  });
  downloadBlob(new Blob([lines.join("\n")], { type: "text/markdown" }), baseName(name) + ".notes.md");
}
