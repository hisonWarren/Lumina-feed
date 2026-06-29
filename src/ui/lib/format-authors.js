/** 作者列表 → 展示用字符串（兼容 string / { name } / OpenAlex 等对象） */
export function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return [];
  return authors.map((a) => {
    if (typeof a === "string") return a.trim();
    if (a && typeof a === "object") {
      const name = a.name || a.display_name
        || [a.given, a.family].filter(Boolean).join(" ")
        || a.literal || a.author || "";
      return String(name).trim();
    }
    return "";
  }).filter(Boolean);
}

/** @param {string[]} authors @param {number} [max] */
export function formatAuthors(authors, max = 4) {
  const names = normalizeAuthors(authors);
  if (!names.length) return "";
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} 等` : shown;
}
