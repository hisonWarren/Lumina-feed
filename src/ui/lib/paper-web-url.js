/** 文献在浏览器中打开的落地页（优先 DOI 解析页）。 */
export function paperWebUrl(p) {
  const doi = String(p?.doi || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (doi) return `https://doi.org/${doi}`;
  const u = String(p?.oaUrl || "").trim();
  if (u && !/\.pdf($|\?)/i.test(u)) return u;
  return null;
}
