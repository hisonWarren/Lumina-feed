// lumina-feed · SCImago Journal Rank 数据集（分区/SJR）
// 官方可下载 CSV（分号分隔，小数用逗号）：https://www.scimagojr.com/journalrank.php?out=xls
// 许可：CC BY-NC — 展示须标注来源，本应用免费非商用。
import type { ScimagoQuartile } from "./types.ts";
import { issnCompact } from "./issn.ts";

export const SCIMAGO_CSV_URL = "https://www.scimagojr.com/journalrank.php?out=xls";
export const SCIMAGO_HOMEPAGE = "https://www.scimagojr.com/";

export interface ScimagoRow extends ScimagoQuartile {
  title?: string;
  issns: string[];   // 紧凑形式（无连字符）
}

export interface ScimagoDataset {
  year?: number;
  rows: ScimagoRow[];
  byIssn: Record<string, ScimagoRow>;  // 紧凑 ISSN → row
}

function splitCsvLine(line: string): string[] {
  // SCImago 用 " 包裹含分隔符的字段（部分导出）；做一次带引号感知的分割
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ";" && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function num(raw?: string): number | undefined {
  if (raw == null) return undefined;
  const s = String(raw).replace(/\s/g, "").replace(",", ".");
  if (!s || s === "-") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** 解析 SCImago CSV 文本 → 数据集 */
export function parseScimagoCsv(text: string): ScimagoDataset {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { rows: [], byIssn: {} };
  const header = splitCsvLine(lines[0]);
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iIssn = idx("Issn");
  const iSjr = idx("SJR");
  const iQ = idx("SJR Best Quartile");
  const iH = idx("H index");
  const iRank = idx("Rank");
  const iCountry = idx("Country");
  const iTitle = idx("Title");
  const iCats = idx("Categories");
  // 年度：从 "Total Docs. (2023)" 之类表头抽取
  let year: number | undefined;
  for (const h of header) { const m = h.match(/\((\d{4})\)/); if (m) { year = Number(m[1]); break; } }

  const rows: ScimagoRow[] = [];
  const byIssn: Record<string, ScimagoRow> = {};
  for (let li = 1; li < lines.length; li++) {
    const c = splitCsvLine(lines[li]);
    if (c.length < header.length - 2) continue;
    const issnRaw = iIssn >= 0 ? c[iIssn] : "";
    const issns = String(issnRaw || "")
      .split(/[,\s]+/)
      .map((x) => issnCompact(x))
      .filter((x): x is string => !!x);
    // 类别分区：从 Categories 起的余下 token 合并，正则抽 Name (Qx)
    let categories: Array<{ name: string; quartile: string }> | undefined;
    if (iCats >= 0) {
      const blob = c.slice(iCats).join(";");
      const found: Array<{ name: string; quartile: string }> = [];
      const re = /([^;()]+?)\s*\(Q([1-4])\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(blob))) found.push({ name: m[1].trim(), quartile: `Q${m[2]}` });
      if (found.length) categories = found;
    }
    const row: ScimagoRow = {
      title: iTitle >= 0 ? c[iTitle] : undefined,
      issns,
      sjr: iSjr >= 0 ? num(c[iSjr]) : undefined,
      bestQuartile: iQ >= 0 ? (c[iQ] || undefined) : undefined,
      hIndex: iH >= 0 ? num(c[iH]) : undefined,
      rank: iRank >= 0 ? num(c[iRank]) : undefined,
      country: iCountry >= 0 ? (c[iCountry] || undefined) : undefined,
      categories,
      year,
    };
    if (!row.issns.length && !row.sjr && !row.bestQuartile) continue;
    rows.push(row);
    for (const is of issns) if (!byIssn[is]) byIssn[is] = row;
  }
  return { year, rows, byIssn };
}

/** 按任一 ISSN 查分区 */
export function scimagoLookup(ds: ScimagoDataset | null | undefined, issns: string[]): ScimagoRow | null {
  if (!ds) return null;
  for (const raw of issns) {
    const c = issnCompact(raw);
    if (c && ds.byIssn[c]) return ds.byIssn[c];
  }
  return null;
}

/** 在线拉取官方 CSV（供手动更新调用）。SCImago 对非浏览器请求返回 403，需带浏览器头。 */
export async function fetchScimagoCsv(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const res = await fetchImpl(SCIMAGO_CSV_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      referer: SCIMAGO_HOMEPAGE,
    },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ scimagojr.com`);
  return res.text();
}
