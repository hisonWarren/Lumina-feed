// lumina-feed · 中科院期刊分区（第三方：LetPub 汇总，非 fenqubiao 官方授权）
import { issnCompact, normalizeIssn } from "./issn.ts";

export const LETPUB_HOMEPAGE = "https://www.letpub.com.cn/index.php?page=journalapp";
export const LETPUB_SOURCE = "LetPub（第三方汇总）";

export interface CasPartitionRow {
  title?: string;
  issns: string[];
  majorZone?: string;       // "1区" … "4区"
  majorCategory?: string;
  minorCategories?: Array<{ name: string; zone?: string }>;
  isTop?: boolean;
  isReview?: boolean;
  year?: number;
  letpubId?: number;
}

export interface CasPartitionDataset {
  year?: number;
  rows: CasPartitionRow[];
  byIssn: Record<string, CasPartitionRow>;
}

export interface CasCrawlProgress {
  phase: "crawl";
  page: number;
  rows: number;
  label: string;
}

const ZONE_RE = /^[1-4]区$/;

function indexRows(rows: CasPartitionRow[]): Record<string, CasPartitionRow> {
  const byIssn: Record<string, CasPartitionRow> = {};
  for (const row of rows) {
    for (const is of row.issns) if (!byIssn[is]) byIssn[is] = row;
  }
  return byIssn;
}

function collectIssns(...raws: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const raw of raws) {
    const c = issnCompact(raw);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function parseZone(raw?: string): string | undefined {
  const s = String(raw || "").trim();
  const m = s.match(/([1-4])\s*区/);
  return m ? `${m[1]}区` : (ZONE_RE.test(s) ? s : undefined);
}

function bestZone(zones: string[]): string | undefined {
  const order = ["1区", "2区", "3区", "4区"];
  for (const z of order) if (zones.includes(z)) return z;
  return zones[0];
}

function mergeRows(base: CasPartitionRow[], extra: CasPartitionRow[]): CasPartitionRow[] {
  const map = new Map<string, CasPartitionRow>();
  for (const row of base) {
    const key = row.issns[0] || row.title || String(row.letpubId || Math.random());
    map.set(key, row);
  }
  for (const row of extra) {
    const key = row.issns[0] || row.title || String(row.letpubId || Math.random());
    const prev = map.get(key);
    map.set(key, {
      ...prev,
      ...row,
      issns: row.issns.length ? row.issns : (prev?.issns || []),
      minorCategories: row.minorCategories?.length ? row.minorCategories : prev?.minorCategories,
    });
  }
  return [...map.values()];
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
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
  return header.findIndex((h) => candidates.some((c) => norm(h) === norm(c) || norm(h).includes(norm(c))));
}

export function parseYearFromLetPubHtml(html: string): number | undefined {
  const m = String(html || "").match(/(\d{4})年\d{1,2}月升级版/);
  return m ? Number(m[1]) : undefined;
}

/** 解析导入表格 */
export function parseCasPartitionTable(text: string): CasPartitionDataset {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { rows: [], byIssn: {} };
  const delim = detectDelimiter(lines[0]);
  const header = splitDelimitedLine(lines[0], delim);
  const iIssn = colIndex(header, "issn", "eissn");
  const iTitle = colIndex(header, "title", "journal", "刊名", "期刊");
  const iMajorZ = colIndex(header, "大类分区", "中科院分区", "分区", "major zone", "cas");
  const iMajorC = colIndex(header, "大类学科", "major");
  const iMinorC = colIndex(header, "小类学科", "minor");
  const iTop = colIndex(header, "top", "top期刊");
  const iYear = colIndex(header, "year", "年份", "年度");

  const rows: CasPartitionRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const c = splitDelimitedLine(lines[li], delim);
    if (!c.length) continue;
    const issns = collectIssns(iIssn >= 0 ? c[iIssn] : "");
    const majorZone = iMajorZ >= 0 ? parseZone(c[iMajorZ]) : undefined;
    const year = iYear >= 0 ? Number(c[iYear]) : undefined;
    if (!issns.length && !c[iTitle >= 0 ? iTitle : -1]) continue;
    rows.push({
      title: iTitle >= 0 ? c[iTitle] : undefined,
      issns,
      majorZone,
      majorCategory: iMajorC >= 0 ? c[iMajorC] : undefined,
      minorCategories: iMinorC >= 0 && c[iMinorC] ? [{ name: c[iMinorC], zone: majorZone }] : undefined,
      isTop: iTop >= 0 ? /^y|yes|是|true|1$/i.test(String(c[iTop] || "")) : undefined,
      year: Number.isFinite(year) ? year : undefined,
    });
  }
  let year: number | undefined;
  for (const r of rows) if (r.year) { year = r.year; break; }
  return { year, rows, byIssn: indexRows(rows) };
}

/** 解析 LetPub 列表页（fieldtag=all 分页） */
export function parseLetPubListHtml(html: string, yearHint?: number): CasPartitionRow[] {
  const year = yearHint ?? parseYearFromLetPubHtml(html);
  const rows: CasPartitionRow[] = [];
  const parts = String(html || "").split(/<tr>/i);
  for (const part of parts) {
    if (!part.includes("journalapp&view=detail")) continue;
    const issnM = part.match(/>(\d{4}-\d{3}[\dX])</i);
    if (!issnM) continue;
    const issns = collectIssns(issnM[1]);
    const titleM = part.match(/view=detail[^>]*>([^<]+)</i);
    const idM = part.match(/journalid=(\d+)/i);
    const zoneM = [...part.matchAll(/>([1-4]区)</g)].map((m) => m[1]);
    const majorZone = bestZone(zoneM);
    const catM = part.match(/大类[：:]([^<]+)/);
    const minorM = part.match(/小类[：:]([^<]+)/);
    rows.push({
      title: titleM?.[1]?.trim(),
      issns,
      majorZone,
      majorCategory: catM?.[1]?.replace(/<br.*/i, "").trim(),
      minorCategories: minorM ? [{ name: minorM[1].replace(/<br.*/i, "").trim(), zone: majorZone }] : undefined,
      year,
      letpubId: idM ? Number(idM[1]) : undefined,
    });
  }
  return rows;
}

/** 解析 LetPub 详情页（大类/小类/Top） */
export function parseLetPubDetailHtml(html: string, yearHint?: number): CasPartitionRow | null {
  const text = String(html || "");
  const year = yearHint ?? parseYearFromLetPubHtml(text);
  const issnM = text.match(/ISSN[：:]\s*(\d{4}-\d{3}[\dX])/i);
  const issns = collectIssns(issnM?.[1]);
  const titleM = text.match(/<h\d[^>]*>([^<]+)</i) || text.match(/journalapp&view=detail[^>]*>([^<]+)</i);
  const blockM = text.match(/期刊分区表[\s\S]{0,4000}?<\/table>/i);
  const block = blockM?.[0] || text;
  const majorZones: string[] = [];
  const minorCategories: Array<{ name: string; zone?: string }> = [];
  const majorParts = [...block.matchAll(/>([^<]{2,40}?)<span[^>]*display:\s*none[^>]*>([1-4]区)<\/span><span[^>]*>([1-4]区)<\/span>/g)];
  for (const m of majorParts) {
    majorZones.push(m[3]);
  }
  if (!majorZones.length) {
    const vis = [...block.matchAll(/<span[^>]*>([1-4]区)<\/span>/g)].map((m) => m[1]);
    if (vis.length) majorZones.push(vis[0]);
  }
  const minorParts = [...block.matchAll(/<td[^>]*>([^<]+)<br>\s*([^<]+)<\/td><td[^>]*>([1-4]区)</g)];
  for (const m of minorParts) {
    minorCategories.push({ name: `${m[1].trim()} / ${m[2].trim()}`, zone: `${m[3]}区`.replace("区区", "区") });
  }
  const idM = text.match(/journalid=(\d+)/i);
  const majorZone = bestZone(majorZones);
  if (!issns.length && !titleM && !majorZone) return null;
  return {
    title: titleM?.[1]?.trim(),
    issns,
    majorZone,
    majorCategory: majorParts[0]?.[1]?.trim(),
    minorCategories: minorCategories.length ? minorCategories : undefined,
    year,
    letpubId: idM ? Number(idM[1]) : undefined,
  };
}

export function buildCasPartitionDataset(rows: CasPartitionRow[], year?: number): CasPartitionDataset {
  return { year, rows, byIssn: indexRows(rows) };
}

export function casPartitionLookup(ds: CasPartitionDataset | null | undefined, issns: string[]): CasPartitionRow | null {
  if (!ds) return null;
  for (const raw of issns) {
    const c = issnCompact(raw);
    if (c && ds.byIssn[c]) return ds.byIssn[c];
  }
  return null;
}

const LETPUB_POST_BODY = {
  searchname: "", searchfield: "", searchimpactlow: "", searchimpacthigh: "",
  searchscitype: "", view: "search", searchcategory1: "", searchcategory2: "",
  searchjcrkind: "", searchopenaccess: "", searchsort: "relevance",
};

async function letpubPost(
  fetchImpl: typeof fetch,
  extra: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  const body = new URLSearchParams({ ...LETPUB_POST_BODY, ...extra });
  const res = await fetchImpl("https://www.letpub.com.cn/index.php?page=journalapp&view=search", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html,*/*",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: "https://www.letpub.com.cn/index.php?page=journalapp&view=search",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ letpub.com.cn`);
  return res.text();
}

/** 按 ISSN 在线查（LetPub 搜索页） */
export async function fetchCasPartitionByIssn(
  issn: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CasPartitionRow | null> {
  const n = normalizeIssn(issn);
  if (!n) return null;
  const html = await letpubPost(fetchImpl, { searchissn: n }, signal);
  const rows = parseLetPubListHtml(html);
  return casPartitionLookup(buildCasPartitionDataset(rows), [n]) || rows[0] || null;
}

/** 拉取 LetPub 全库列表单页 */
export async function fetchLetPubListPage(
  page: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ rows: CasPartitionRow[]; year?: number; html: string }> {
  const url = `https://www.letpub.com.cn/index.php?page=journalapp&view=researchfield&fieldtag=all&firstletter=&currentpage=${page}`;
  const res = await fetchImpl(url, {
    headers: {
      accept: "text/html,*/*",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: LETPUB_HOMEPAGE,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ letpub.com.cn`);
  const html = await res.text();
  const year = parseYearFromLetPubHtml(html);
  const rows = parseLetPubListHtml(html, year);
  return { rows, year, html };
}

/** 分页爬取 LetPub 全库（约 4.4 万刊，需数十分钟；建议优先导入表格） */
export async function crawlCasPartitionDataset(
  fetchImpl: typeof fetch = fetch,
  onProgress?: (p: CasCrawlProgress) => void,
  opts?: { signal?: AbortSignal; pageDelayMs?: number; maxPages?: number },
): Promise<CasPartitionDataset> {
  const delay = opts?.pageDelayMs ?? 350;
  let page = 1;
  let allRows: CasPartitionRow[] = [];
  let year: number | undefined;
  let emptyStreak = 0;

  while (true) {
    if (opts?.signal?.aborted) throw new Error("aborted");
    if (opts?.maxPages != null && page > opts.maxPages) break;
    const { rows, year: y } = await fetchLetPubListPage(page, fetchImpl, opts?.signal);
    if (y) year = y;
    if (!rows.length) {
      emptyStreak++;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
      allRows = mergeRows(allRows, rows);
    }
    onProgress?.({
      phase: "crawl",
      page,
      rows: allRows.length,
      label: `LetPub 第 ${page} 页 · 已收录 ${allRows.length.toLocaleString()} 条`,
    });
    page++;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return buildCasPartitionDataset(allRows, year);
}
