// lumina-feed · LetPub 影响因子（第三方汇总，非 Clarivate 官方）
// 国内可直连；官方「最新 IF」常需登录，公开页仍可读：IF 历史图末值、五年 IF、实时 IF、标题 IF。
import { issnCompact, normalizeIssn } from "./issn.ts";
import { LETPUB_HOMEPAGE } from "./cas-partition.ts";

export const LETPUB_IF_SOURCE = "LetPub";

export interface LetPubImpactRow {
  title?: string;
  issns: string[];
  letpubId?: number;
  /** 优先：IF 历史图末值（接近 JCR 年报）；否则标题/实时 */
  jif?: number;
  jif5yr?: number;
  realtimeIf?: number;
  year?: number;
  sourceHomepage?: string;
}

function num(raw?: string | null): number | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s || /^n\/?a$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function lastDecimal(text: string): number | undefined {
  const ms = [...String(text || "").matchAll(/(\d+(?:\.\d+)?)/g)];
  if (!ms.length) return undefined;
  // Prefer a decimal IF-like value (e.g. 55.42 over year 2026)
  for (let i = ms.length - 1; i >= 0; i--) {
    const n = Number(ms[i][1]);
    if (!Number.isFinite(n)) continue;
    if (String(ms[i][1]).includes(".")) return n;
  }
  const n = Number(ms[ms.length - 1][1]);
  return Number.isFinite(n) ? n : undefined;
}

function collectIssns(...raws: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const raw of raws) {
    const c = issnCompact(raw);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function cellAfterLabel(html: string, labelRe: RegExp): string | undefined {
  const re = new RegExp(labelRe.source + "[\\s\\S]{0,500}?<\\/td>\\s*<TD[^>]*>([\\s\\S]*?)<\\/td>", "i");
  const m = html.match(re);
  return m ? m[1] : undefined;
}

/** 从 LetPub 详情页解析影响因子（无需登录的字段） */
export function parseLetPubImpactHtml(html: string): LetPubImpactRow | null {
  const text = String(html || "");
  if (!text) return null;

  const issnM = text.match(/期刊ISSN<\/td>\s*<TD[^>]*>\s*(\d{4}-\d{3}[\dX])/i);
  const eissnM = text.match(/E-ISSN<\/td>\s*<TD[^>]*>\s*(\d{4}-\d{3}[\dX])/i);
  const issns = collectIssns(issnM?.[1], eissnM?.[1]);
  const idM = text.match(/journalid=(\d+)/i);
  const letpubId = idM ? Number(idM[1]) : undefined;
  // 标题：优先文档 title「【LetPub】NAME 影响因子…」，避免页眉品牌 h1
  const fromDocTitle = text.match(/<title>【LetPub】\s*([^<\s][^<]{0,80}?)\s*影响因子/i)
    || text.match(/detail&journalid=\d+[^>]*>\s*([^<]+?)\s*杂志/i);
  const fromH1 = text.match(/<h1[^>]*>\s*([A-Za-z][A-Za-z0-9\s\-&.]{1,80}?)\s*</i);
  const title = (fromDocTitle?.[1] || fromH1?.[1] || "").trim() || undefined;

  // IF 历史图：name:'IF值' … data : [..., 56.1]
  let chartIf: number | undefined;
  let chartYear: number | undefined;
  const ifSeries = text.match(/name\s*:\s*['"]IF值['"][\s\S]*?data\s*:\s*\[([0-9.,\s]+)\]/i);
  if (ifSeries) {
    const nums = ifSeries[1].split(",").map((s) => num(s.trim())).filter((n): n is number => n != null);
    if (nums.length) chartIf = nums[nums.length - 1];
  }
  const ifPos = text.search(/name\s*:\s*['"]IF值['"]/i);
  const ifWindow = ifPos >= 0 ? text.slice(Math.max(0, ifPos - 1600), ifPos + 200) : "";
  const yearPairs = [...ifWindow.matchAll(/'(\d{4})-(\d{4})年度'/g)];
  if (yearPairs.length) chartYear = Number(yearPairs[yearPairs.length - 1][1]);
  else {
    const ys = [...ifWindow.matchAll(/'(\d{4})年度'/g)].map((m) => Number(m[1]));
    if (ys.length) chartYear = ys[ys.length - 1];
  }
  const fiveCell = cellAfterLabel(text, /五年IF/);
  const jif5yr = fiveCell ? lastDecimal(fiveCell.replace(/<[^>]+>/g, " ")) : undefined;

  const rtCell = cellAfterLabel(text, /实时影响因子/);
  const realtimeIf = rtCell ? lastDecimal(rtCell.replace(/<[^>]+>/g, " ")) : undefined;

  const titleIf = num(text.match(/影响因子\s*([0-9]+(?:\.[0-9]+)?)/)?.[1]);

  const jif = chartIf ?? titleIf ?? realtimeIf;
  if (jif == null && jif5yr == null && !issns.length && !letpubId) return null;

  return {
    title,
    issns,
    letpubId,
    jif,
    jif5yr,
    realtimeIf,
    year: chartYear,
    sourceHomepage: letpubId
      ? `${LETPUB_HOMEPAGE}&view=detail&journalid=${letpubId}`
      : LETPUB_HOMEPAGE,
  };
}

const LETPUB_POST_BODY = {
  searchname: "", searchfield: "", searchimpactlow: "", searchimpacthigh: "",
  searchscitype: "", view: "search", searchcategory1: "", searchcategory2: "",
  searchjcrkind: "", searchopenaccess: "", searchsort: "relevance",
};

async function letpubSearchHtml(
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

function firstJournalId(html: string): number | undefined {
  for (const m of String(html || "").matchAll(/journalid=(\d+)/gi)) {
    const id = Number(m[1]);
    if (id > 0) return id;
  }
  return undefined;
}

export async function fetchLetPubDetailHtml(
  journalId: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${LETPUB_HOMEPAGE}&view=detail&journalid=${journalId}`;
  const res = await fetchImpl(url, {
    headers: {
      accept: "text/html,*/*",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: LETPUB_HOMEPAGE,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ letpub detail`);
  return res.text();
}

/** ISSN → LetPub 搜索拿 journalid → 详情页解析 IF（国内直连，避开 wos CF） */
export async function fetchLetPubImpactByIssn(
  issn: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<LetPubImpactRow | null> {
  const n = normalizeIssn(issn);
  if (!n) return null;
  const searchHtml = await letpubSearchHtml(fetchImpl, { searchissn: n }, signal);
  const id = firstJournalId(searchHtml);
  if (!id) return null;
  if (signal?.aborted) throw new Error("aborted");
  const detail = await fetchLetPubDetailHtml(id, fetchImpl, signal);
  const row = parseLetPubImpactHtml(detail);
  if (!row) return null;
  // Ensure ISSN from query is indexed even if detail parse missed it
  if (!row.issns.includes(issnCompact(n)!)) {
    row.issns = [...row.issns, issnCompact(n)!];
  }
  row.letpubId = row.letpubId || id;
  row.sourceHomepage = `${LETPUB_HOMEPAGE}&view=detail&journalid=${row.letpubId}`;
  return row;
}
