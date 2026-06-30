/** 题名是否像「由文件名自动推导」——用于导入后轻提示，不阻断加入 */
export function looksLikeAutoImportTitle(title, provenance) {
  const s = String(title || "").trim();
  if (!s || s === "未命名 PDF") return true;
  if (provenance === "local_import" || provenance === "recovered") {
    if (/^1[\s-]?s2\.0/i.test(s)) return true;
    if (/^s\d{10,}/i.test(s.replace(/\s/g, ""))) return true;
    if (s.startsWith("import-")) return true;
    const words = s.split(/\s+/).filter(Boolean).length;
    if (words <= 5 && s.length < 56 && !/\b(review|study|analysis|model|effect|association)\b/i.test(s)) return true;
  }
  return false;
}
