// lumina-feed · ISSN 规范化与校验

/** 归一为 "XXXX-XXXX" 大写形式；非法返回 null */
export function normalizeIssn(raw?: string): string | null {
  const s = String(raw || "").toUpperCase().replace(/[^0-9X]/g, "");
  if (s.length !== 8) return null;
  if (!/^\d{7}[\dX]$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** 去掉连字符的紧凑形式（SCImago 表内 ISSN 无连字符） */
export function issnCompact(raw?: string): string | null {
  const n = normalizeIssn(raw);
  return n ? n.replace("-", "") : null;
}

/** 输入是否像 ISSN（用户可能带/不带连字符） */
export function looksLikeIssn(raw?: string): boolean {
  return normalizeIssn(raw) !== null;
}

/** ISSN 校验位是否正确（ISO 3297）。用于严格校验，可选。 */
export function isValidIssnChecksum(raw?: string): boolean {
  const n = normalizeIssn(raw);
  if (!n) return false;
  const digits = n.replace("-", "");
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(digits[i]) * (8 - i);
  const check = digits[7] === "X" ? 10 : Number(digits[7]);
  return (sum + check) % 11 === 0;
}
