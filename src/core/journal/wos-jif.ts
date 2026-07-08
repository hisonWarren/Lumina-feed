// lumina-feed · WoS Journal Info (wos-journal.info) JIF 数据集
// 第三方汇总站，非 Clarivate 官方；展示须标注来源。用户可导入表格或在线分页拉取。
import { issnCompact, normalizeIssn } from "./issn.ts";

export const WOS_JIF_HOMEPAGE = "https://wos-journal.info/";
export const WOS_JIF_SOURCE = "wos-journal.info";

export interface WosJifRow {
  wosId?: number;
  title?: string;
  issns: string[];
  jif?: number;
  jif5yr?: number;
  wosIndexes?: string;
  abbreviation?: string;
  category?: string;
  country?: string;
  publisher?: string;
  oaSupport?: string;
  wosStatus?: string;
  bestRanking?: string;
  year?: number;
}

export interface WosJifDataset {
  year?: number;
  rows: WosJifRow[];
  byIssn: Record<string, WosJifRow>;
}

export interface WosJifCrawlProgress {
  phase: "crawl";
  page: number;
  totalPages?: number;
  rows: number;
  label: string;
}

function num(raw?: string): number | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s || /^n\/?a$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function fieldContent(block: string, label: string): string | undefined {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc}:[\\s\\S]*?<div class='content[^']*'[^>]*>\\s*([^<]+)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : undefined;
}

function fieldContentHtml(block: string, label: string): string | undefined {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc}:[\\s\\S]*?<div class='content[^']*'[^>]*>([\\s\\S]*?)<\\/div>`, "i");
  const m = block.match(re);
  if (!m) return undefined;
  return m[1].replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim() || undefined;
}

function collectIssns(issn?: string, eissn?: string): string[] {
  const out: string[] = [];
  for (const raw of [issn, eissn]) {
    const c = issnCompact(raw);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function indexRows(rows: WosJifRow[]): Record<string, WosJifRow> {
  const byIssn: Record<string, WosJifRow> = {};
  for (const row of rows) {
    for (const is of row.issns) if (!byIssn[is]) byIssn[is] = row;
  }
  return byIssn;
}

function mergeDataset(base: WosJifDataset, extra: WosJifRow[]): WosJifDataset {
  const map = new Map<string, WosJifRow>();
  for (const row of base.rows) {
    const key = row.issns[0] || row.title || String(row.wosId || Math.random());
    map.set(key, row);
  }
  for (const row of extra) {
    const key = row.issns[0] || row.title || String(row.wosId || Math.random());
    map.set(key, { ...map.get(key), ...row, issns: row.issns.length ? row.issns : (map.get(key)?.issns || []) });
  }
  const rows = [...map.values()];
  return { year: base.year, rows, byIssn: indexRows(rows) };
}

/** 从 wos-journal.info 列表/检索页 HTML 解析期刊卡片 */
export function parseWosJifListingHtml(html: string, yearHint?: number): WosJifRow[] {
  const text = String(html || "");
  const year = yearHint ?? parseYearFromHtml(text);
  const parts = text.split(/<div class='title col-4 col-md-3'>\s*ID:/i);
  const rows: WosJifRow[] = [];
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const idMatch = block.match(/>\s*#(\d+)\s*<\/div>/);
    const title = fieldContent(block, "Journal Title");
    const issn = fieldContent(block, "ISSN");
    const eissn = fieldContent(block, "eISSN");
    const issns = collectIssns(issn, eissn);
    const jif = num(fieldContent(block, "Journal Impact Factor (JIF)"));
    const wosIndexes = fieldContentHtml(block, "WoS Core Citation Indexes");
    const journalId = block.match(/journalid\/(\d+)/i)?.[1];
    const wosId = (idMatch ? Number(idMatch[1]) : undefined) ?? (journalId ? Number(journalId) : undefined);
    if (!issns.length && !title && jif == null) continue;
    rows.push({ wosId, title, issns, jif, wosIndexes, year });
  }
  return rows;
}

/** 从期刊详情页补充 5 年 IF 等字段 */
export function parseWosJifDetailHtml(html: string, yearHint?: number): WosJifRow | null {
  const text = String(html || "");
  const year = yearHint ?? parseYearFromHtml(text);
  const title = text.match(/»\s*([^<]+)/)?.[1]?.trim();
  const issn = fieldContent(text, "ISSN");
  const eissn = fieldContent(text, "eISSN");
  const issns = collectIssns(issn, eissn);
  const jif = num(fieldContent(text, "Journal Impact Factor (JIF)"));
  const jif5yr = num(fieldContent(text, "5-year Impact Factor"));
  const wosIndexes = fieldContentHtml(text, "WoS Core Citation Indexes");
  const abbreviation = fieldContent(text, "Abbreviation");
  const category = fieldContent(text, "Category");
  const country = fieldContent(text, "Country");
  const publisher = fieldContent(text, "Publisher");
  const oaSupport = fieldContentHtml(text, "Open Access Support");
  const wosStatus = fieldContent(text, "Status in WoS core");
  const bestRanking = fieldContentHtml(text, "Best Ranking");
  if (!issns.length && !title && jif == null) return null;
  return {
    title, issns, jif, jif5yr, wosIndexes, abbreviation, category, country, publisher,
    oaSupport, wosStatus, bestRanking, year,
  };
}

export function parseYearFromHtml(html: string): number | undefined {
  const m = String(html || "").match(/Latest data of (\d{4})/i);
  return m ? Number(m[1]) : undefined;
}

function splitDelimitedLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === delim && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, ""));
}

function detectDelimiter(headerLine: string): string {
  const counts: Array<[string, number]> = [[";", (headerLine.match(/;/g) || []).length], [",", (headerLine.match(/,/g) || []).length], ["\t", (headerLine.match(/\t/g) || []).length]];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

function colIndex(header: string[], ...candidates: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return header.findIndex((h) => candidates.some((c) => norm(h) === norm(c)));
}

/** 解析导入表格（CSV / TSV / 分号分隔） */
export function parseWosJifTable(text: string): WosJifDataset {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { rows: [], byIssn: {} };
  const delim = detectDelimiter(lines[0]);
  const header = splitDelimitedLine(lines[0], delim).map((h) => h.toLowerCase());
  const iIssn = colIndex(header, "issn");
  const iEissn = colIndex(header, "eissn", "e-issn");
  const iTitle = colIndex(header, "title", "journal", "journal title");
  const iJif = colIndex(header, "jif", "impact factor", "impact_factor", "journal impact factor");
  const iJif5 = colIndex(header, "5-year impact factor", "5 year", "five year", "jif5");
  const iYear = colIndex(header, "year", "data year");
  const iWosId = colIndex(header, "wos id", "id", "journalid", "journal id");

  const rows: WosJifRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const c = splitDelimitedLine(lines[li], delim);
    if (!c.length) continue;
    const issn = iIssn >= 0 ? c[iIssn] : "";
    const eissn = iEissn >= 0 ? c[iEissn] : "";
    const issns = collectIssns(issn, eissn);
    const title = iTitle >= 0 ? c[iTitle] : undefined;
    const jif = iJif >= 0 ? num(c[iJif]) : undefined;
    const jif5yr = iJif5 >= 0 ? num(c[iJif5]) : undefined;
    const year = iYear >= 0 ? num(c[iYear]) : undefined;
    const wosId = iWosId >= 0 ? num(c[iWosId]) : undefined;
    if (!issns.length && !title) continue;
    rows.push({ wosId, title, issns, jif, jif5yr, year });
  }
  let year: number | undefined;
  for (const r of rows) if (r.year) { year = r.year; break; }
  return { year, rows, byIssn: indexRows(rows) };
}

export function buildWosJifDataset(rows: WosJifRow[], year?: number): WosJifDataset {
  return { year, rows, byIssn: indexRows(rows) };
}

/** 按任一 ISSN 查 JIF */
export function wosJifLookup(ds: WosJifDataset | null | undefined, issns: string[]): WosJifRow | null {
  if (!ds) return null;
  for (const raw of issns) {
    const c = issnCompact(raw);
    if (c && ds.byIssn[c]) return ds.byIssn[c];
  }
  return null;
}

function listingUrl(page: number, search?: string): string {
  const q = new URLSearchParams();
  if (search) q.set("jsearch", search);
  else q.set("jsearch", "");
  q.set("page", String(page));
  return `${WOS_JIF_HOMEPAGE}?${q.toString()}`;
}

/** 拉取单页列表 */
export async function fetchWosJifPage(
  page: number,
  fetchImpl: typeof fetch = fetch,
  opts?: { search?: string; signal?: AbortSignal },
): Promise<{ rows: WosJifRow[]; year?: number; html: string }> {
  const url = listingUrl(page, opts?.search);
  const res = await fetchImpl(url, {
    headers: {
      accept: "text/html,*/*",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      referer: WOS_JIF_HOMEPAGE,
    },
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ wos-journal.info`);
  const html = await res.text();
  const year = parseYearFromHtml(html);
  const rows = parseWosJifListingHtml(html, year);
  return { rows, year, html };
}

/** 分页爬取全库（约 2.4 万刊，需数分钟） */
export async function crawlWosJifDataset(
  fetchImpl: typeof fetch = fetch,
  onProgress?: (p: WosJifCrawlProgress) => void,
  opts?: { signal?: AbortSignal; pageDelayMs?: number; maxPages?: number },
): Promise<WosJifDataset> {
  const delay = opts?.pageDelayMs ?? 120;
  let page = 0;
  let allRows: WosJifRow[] = [];
  let year: number | undefined;
  let emptyStreak = 0;

  while (true) {
    if (opts?.signal?.aborted) throw new Error("aborted");
    if (opts?.maxPages != null && page >= opts.maxPages) break;
    const { rows, year: y } = await fetchWosJifPage(page, fetchImpl, { signal: opts?.signal });
    if (y) year = y;
    if (!rows.length) {
      emptyStreak++;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
      allRows = mergeDataset({ year, rows: allRows, byIssn: {} }, rows).rows;
    }
    onProgress?.({
      phase: "crawl",
      page: page + 1,
      rows: allRows.length,
      label: `正在拉取第 ${page + 1} 页 · 已收录 ${allRows.length.toLocaleString()} 条`,
    });
    page++;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  return buildWosJifDataset(allRows, year);
}

/** ISSN 在线补查（单刊，用于数据集未覆盖时）；命中后拉详情页补全 5 年 IF / WoS 收录等字段 */
export async function fetchWosJifByIssn(
  issn: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WosJifRow | null> {
  const n = normalizeIssn(issn);
  if (!n) return null;
  const { rows, year } = await fetchWosJifPage(0, fetchImpl, { search: n, signal });
  const base = wosJifLookup(buildWosJifDataset(rows, year), [n]) || rows[0] || null;
  if (!base) return null;
  if (!base.wosId) return base;
  try {
    const detail = await fetchWosJifDetail(base.wosId, fetchImpl, signal);
    if (!detail) return base;
    return {
      ...base,
      ...detail,
      wosId: base.wosId,
      issns: detail.issns.length ? detail.issns : base.issns,
      jif: detail.jif ?? base.jif,
      jif5yr: detail.jif5yr ?? base.jif5yr,
      wosIndexes: detail.wosIndexes ?? base.wosIndexes,
    };
  } catch {
    return base;
  }
}

/** 期刊详情页（含 5 年 IF、WoS 核心收录、学科类别等） */
export async function fetchWosJifDetail(
  wosId: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WosJifRow | null> {
  if (!wosId) return null;
  const url = `${WOS_JIF_HOMEPAGE}journalid/${wosId}`;
  const res = await fetchImpl(url, {
    headers: {
      accept: "text/html,*/*",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      referer: WOS_JIF_HOMEPAGE,
    },
    signal,
  });
  if (!res.ok) return null;
  const row = parseWosJifDetailHtml(await res.text());
  if (row) row.wosId = wosId;
  return row;
}
