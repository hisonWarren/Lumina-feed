// 识别「像完整论文标题」的输入 → 触发 Title Fast Lane（与 DOI 快路径并列）

/** 去掉 [title] 等字段标签与首尾引号 */
export function titleQueryText(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BOOL_HEAVY = /\b(AND|OR|NOT)\b/i;

/** 是否应走标题快路径（field=title 或启发式像完整标题） */
export function isTitleLikeQuery(raw: string, field?: string): boolean {
  if (field === "title") return titleQueryText(raw).length >= 8;
  const t = titleQueryText(raw);
  if (t.length < 18) return false;
  if (BOOL_HEAVY.test(t) && t.split(/\s+/).length > 10) return false;
  const words = t.match(/[\u4e00-\u9fff]+|[a-zA-Z]{3,}/g) || [];
  if (words.length >= 4) return true;
  if (t.length >= 32) return true;
  if (/[:—–\-;]/.test(t) && words.length >= 3) return true;
  return false;
}
