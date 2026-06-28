// Lumina Feed · 引用与导出 —— patch: library
// 以 CSL-JSON 为中介，生成 APA/MLA/Chicago/Vancouver/BibTeX 文本，及 .bib/.ris/CSL-JSON 导出（喂 Zotero / 写作，不锁定）。
// 作者为字符串（来源各异），尽力解析 family/given；格式为常见近似，正式投稿请以期刊要求复核。

function parseName(s) {
  const t = String(s || "").trim();
  if (!t) return { family: "", given: "" };
  if (t.includes(",")) { const [f, g] = t.split(","); return { family: f.trim(), given: (g || "").trim() }; }
  const parts = t.split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^[A-Z][A-Z.]{0,3}$/.test(last)) return { family: parts.slice(0, -1).join(" "), given: last.replace(/\./g, "") }; // "Smith JA"
    return { family: last, given: parts.slice(0, -1).join(" ") };                                                        // "John Smith"
  }
  return { family: t, given: "" };
}
const authorsOf = (p) => (Array.isArray(p.authors) ? p.authors : []).map(parseName).filter((a) => a.family);
const initials = (given) => given ? given.split(/\s+/).map((w) => (w[0] ? w[0].toUpperCase() + "." : "")).join("") : "";
const yearOf = (p) => (p.year ? String(p.year) : (p.pubDate ? String(p.pubDate).slice(0, 4) : "n.d."));
const citeKey = (p) => { const a = authorsOf(p)[0]; return ((a && a.family) || "ref").replace(/[^A-Za-z]/g, "") + (p.year || "") + (String(p.title || "").split(/\s+/)[0] || "").replace(/[^A-Za-z]/g, ""); };

/** Paper → CSL-JSON item */
export function toCSL(p) {
  const item = {
    id: citeKey(p), type: "article-journal",
    title: p.title || "", "container-title": p.journal || p.abbr || "",
    author: authorsOf(p).map((a) => ({ family: a.family, given: a.given })),
  };
  if (p.year) item.issued = { "date-parts": [[Number(p.year)]] };
  if (p.doi) item.DOI = p.doi;
  return item;
}

// ── 多样式（近似）──
export function formatAPA(p) {
  const au = authorsOf(p).map((a) => `${a.family}, ${initials(a.given)}`).join(", ");
  return `${au}${au ? " " : ""}(${yearOf(p)}). ${p.title || ""}. ${p.journal || ""}.${p.doi ? " https://doi.org/" + p.doi : ""}`.trim();
}
export function formatMLA(p) {
  const a = authorsOf(p); const lead = a.length ? `${a[0].family}, ${a[0].given}${a.length > 1 ? ", et al" : ""}. ` : "";
  return `${lead}"${p.title || ""}." ${p.journal || ""}, ${yearOf(p)}.${p.doi ? " doi:" + p.doi : ""}`.trim();
}
export function formatChicago(p) {
  const au = authorsOf(p).map((a) => `${a.given} ${a.family}`.trim()).join(", ");
  return `${au}${au ? ". " : ""}"${p.title || ""}." ${p.journal || ""} (${yearOf(p)}).${p.doi ? " https://doi.org/" + p.doi : ""}`.trim();
}
export function formatVancouver(p) {
  const au = authorsOf(p).map((a) => `${a.family} ${initials(a.given)}`.trim()).join(", ");
  return `${au}${au ? ". " : ""}${p.title || ""}. ${p.journal || ""}. ${yearOf(p)}.${p.doi ? " doi:" + p.doi : ""}`.trim();
}
export function formatBibTeX(p) {
  const au = authorsOf(p).map((a) => `${a.family}, ${a.given}`.trim()).join(" and ");
  const L = [`@article{${citeKey(p)},`];
  if (p.title) L.push(`  title   = {${p.title}},`);
  if (au) L.push(`  author  = {${au}},`);
  if (p.journal) L.push(`  journal = {${p.journal}},`);
  if (p.year) L.push(`  year    = {${p.year}},`);
  if (p.doi) L.push(`  doi     = {${p.doi}},`);
  L.push("}");
  return L.join("\n");
}
export const STYLES = [["apa", "APA", formatAPA], ["mla", "MLA", formatMLA], ["chicago", "Chicago", formatChicago], ["vancouver", "Vancouver", formatVancouver], ["bibtex", "BibTeX", formatBibTeX]];
export function formatCitation(style, p) { const f = STYLES.find((s) => s[0] === style); return f ? f[2](p) : formatAPA(p); }

// ── 导出（.bib / .ris / CSL-JSON）──
function dl(text, mime, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function exportBib(papers, name) { dl((papers || []).map(formatBibTeX).join("\n\n"), "application/x-bibtex", (name || "lumina") + ".bib"); }
export function exportCslJson(papers, name) { dl(JSON.stringify((papers || []).map(toCSL), null, 2), "application/json", (name || "lumina") + ".csl.json"); }
export function exportRis(papers, name) {
  const blocks = (papers || []).map((p) => {
    const L = ["TY  - JOUR"];
    authorsOf(p).forEach((a) => L.push(`AU  - ${a.family}, ${a.given}`.trim()));
    if (p.title) L.push(`TI  - ${p.title}`);
    if (p.journal) L.push(`JO  - ${p.journal}`);
    if (p.year) L.push(`PY  - ${p.year}`);
    if (p.doi) L.push(`DO  - ${p.doi}`);
    L.push("ER  - ");
    return L.join("\n");
  });
  dl(blocks.join("\n\n"), "application/x-research-info-systems", (name || "lumina") + ".ris");
}
