// lumina-feed · 备选全文渠道（LibGen / Anna's Archive / Sci-Hub）
// 端口自「文献检索与PDF下载_实现资料」，与 OA 候选统一按 priority 排序。
import altMirrors from "./config/alt-mirrors.json" with { type: "json" };
import type { PdfCandidate, UrlCandidate } from "./candidate.ts";
import type { AltMirrorSettings } from "./mirror-health.ts";
import { orderMirrors } from "./mirror-health.ts";
import { normDoi as normDoiKey, titleFingerprint } from "../dedupe.ts";
import { jaccard } from "../locate/enrich-metadata.ts";

export type { AltMirrorSettings };

const MD5_RE = /md5=([A-Fa-f0-9]{32})/;
const ROW_RE = /<tr[^>]*>(.*?)<\/tr>/gis;
const CELL_RE = /<td[^>]*>(.*?)<\/td>/gis;
const GET_RE = /href="(get\.php\?md5=[A-Fa-f0-9]{32}&key=\w+)"/;
const MD5_PATH_RE = /\/md5\/([a-f0-9]{32})/gi;
const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

type FetchImpl = typeof fetch;

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normDoi(doi: string): string {
  return normDoiKey(doi) ?? doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
}

export type LibgenRow = { md5: string; ext: string; title?: string; authors?: string[]; year?: number; doi?: string };

const TITLE_PICK_MIN = 0.82;

function doiEq(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return normDoi(a) === normDoi(b);
}

/** LibGen 检索结果排序：DOI 精确匹配 > 标题 Jaccard；DOI 列检索拒绝错配行。 */
export function pickBestLibgenRow(
  rows: LibgenRow[],
  opts: { expectedDoi?: string; expectedTitle?: string; column?: string },
): LibgenRow | null {
  const pdfRows = rows.filter((r) => r.ext === "pdf");
  if (!pdfRows.length) return null;

  let best: LibgenRow | null = null;
  let bestScore = -1;
  for (const row of pdfRows) {
    let score = -1;
    if (opts.expectedDoi && row.doi) {
      if (doiEq(row.doi, opts.expectedDoi)) score = 100;
      else if (opts.column === "doi") continue;
    } else if (opts.column === "doi" && opts.expectedDoi) {
      continue;
    }

    if (opts.expectedTitle && row.title) {
      const tScore = jaccard(titleFingerprint(opts.expectedTitle), titleFingerprint(row.title));
      if (opts.column === "title" && tScore < TITLE_PICK_MIN) continue;
      score = Math.max(score, tScore * 50);
    }

    if (score < 0) continue;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}

function dedupeUrls(cands: UrlCandidate[]): UrlCandidate[] {
  const seen = new Set<string>();
  const out: UrlCandidate[] = [];
  for (const c of cands.sort((a, b) => a.priority - b.priority)) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

export function getLibgenMirrors(): string[] {
  const configured = (altMirrors as { libgen_mirrors?: string[] }).libgen_mirrors ?? [];
  const seen = new Set<string>();
  return configured
    .map((m) => m.replace(/\/$/, ""))
    .filter((m) => {
      const k = m.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function getAnnasMirrors(): string[] {
  const configured = (altMirrors as { annas_mirrors?: string[] }).annas_mirrors ?? [];
  const seen = new Set<string>();
  return configured
    .map((m) => (m.startsWith("http") ? m : `https://${m}`).replace(/\/$/, ""))
    .filter((m) => {
      const k = m.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function getScihubMirrors(): string[] {
  return (altMirrors as { scihub_mirrors?: string[] }).scihub_mirrors ?? [
    "https://sci-hub.se",
    "https://sci-hub.st",
    "https://sci-hub.ru",
  ];
}

export function parseLibgenRows(html: string): { md5: string; ext: string; title?: string; authors?: string[]; year?: number; doi?: string }[] {
  const rows: { md5: string; ext: string; title?: string; authors?: string[]; year?: number; doi?: string }[] = [];
  for (const row of html.matchAll(ROW_RE)) {
    const md5m = MD5_RE.exec(row[1]);
    if (!md5m) continue;
    const cells = [...row[1].matchAll(CELL_RE)].map((c) => stripHtml(c[1]));
    if (cells.length < 8) continue;
    const doiM = DOI_RE.exec(row[1]);
    const yr = parseInt(cells[4] ?? "", 10);
    rows.push({
      md5: md5m[1],
      ext: cells[7].toLowerCase(),
      title: cells[2]?.trim() || undefined,
      authors: cells[1] ? cells[1].split(/[,;]/).map((a) => a.trim()).filter(Boolean) : [],
      year: Number.isFinite(yr) ? yr : undefined,
      doi: doiM ? normDoi(doiM[0]) : undefined,
    });
  }
  return rows;
}

/** LibGen 检索 → SearchHit[]（USP 搜索适配器用） */
export async function searchLibgenHits(
  query: string,
  deps: { column?: string; limit?: number; fetchImpl?: FetchImpl; signal?: AbortSignal; mirrorSettings?: AltMirrorSettings },
): Promise<import("../model.ts").SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const f = deps.fetchImpl ?? fetch;
  const limit = deps.limit ?? 25;
  const { ordered } = await orderMirrors("libgen", deps.mirrorSettings, { fetchImpl: f, signal: deps.signal });
  const out: import("../model.ts").SearchHit[] = [];
  const seen = new Set<string>();

  for (const mirror of ordered) {
    try {
      const params = new URLSearchParams({ req: q });
      if (deps.column) params.set("column", deps.column);
      const res = await f(`${mirror}/index.php?${params}`, { signal: deps.signal, redirect: "follow" } as RequestInit);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.includes("md5=")) continue;
      for (const row of parseLibgenRows(text)) {
        if (!row.title || row.ext !== "pdf") continue;
        const key = row.doi ? `doi:${row.doi}` : `md5:${row.md5}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          source: "libgen",
          doi: row.doi,
          title: row.title,
          authors: row.authors ?? [],
          year: row.year,
          isPreprint: false,
          peerReviewed: false,
        });
        if (out.length >= limit) return out;
      }
      if (out.length) break;
    } catch { /* 下一镜像 */ }
  }
  return out;
}

/** Anna's Archive 关键词检索 → SearchHit[] */
export async function searchAnnasKeywordHits(
  query: string,
  deps: { limit?: number; fetchImpl?: FetchImpl; signal?: AbortSignal; mirrorSettings?: AltMirrorSettings },
): Promise<import("../model.ts").SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const f = deps.fetchImpl ?? fetch;
  const limit = deps.limit ?? 25;
  const { ordered } = await orderMirrors("annas", deps.mirrorSettings, { fetchImpl: f, signal: deps.signal });
  const out: import("../model.ts").SearchHit[] = [];
  const seen = new Set<string>();

  for (const mirror of ordered) {
    try {
      const res = await f(`${mirror}/search?q=${encodeURIComponent(q)}`, {
        signal: deps.signal,
        headers: { accept: "text/html" },
        redirect: "follow",
      } as RequestInit);
      if (!res.ok) continue;
      const html = await res.text();
      for (const m of html.matchAll(/<a[^>]*href="([^"]*\/md5\/[a-f0-9]{32}[^"]*)"[^>]*>([^<]{10,})</gi)) {
        const title = stripHtml(m[2]);
        if (!title || title.length < 8) continue;
        const block = html.slice(Math.max(0, html.indexOf(m[0]) - 300), html.indexOf(m[0]) + 500);
        const doiM = DOI_RE.exec(block);
        const doi = doiM ? normDoi(doiM[0]) : undefined;
        const key = doi ? `doi:${doi}` : `t:${titleFingerprint(title)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ source: "annas", doi, title, authors: [], isPreprint: false, peerReviewed: false });
        if (out.length >= limit) return out;
      }
      if (out.length) break;
    } catch { /* 下一镜像 */ }
  }
  return out;
}

async function resolveLibgenGetUrl(
  f: FetchImpl,
  mirror: string,
  md5: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await f(`${mirror}/ads.php?md5=${md5}`, { signal, redirect: "follow" } as RequestInit);
    if (!res.ok) return null;
    const text = await res.text();
    const m = GET_RE.exec(text);
    return m ? `${mirror}/${m[1]}` : null;
  } catch {
    return null;
  }
}

async function searchLibgen(
  f: FetchImpl,
  query: string,
  opts: {
    column?: string;
    priority: number;
    signal?: AbortSignal;
    mirrors?: string[];
    expectedDoi?: string;
    expectedTitle?: string;
  },
): Promise<UrlCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const out: UrlCandidate[] = [];
  const mirrorList = opts.mirrors?.length ? opts.mirrors : getLibgenMirrors();
  for (const mirror of mirrorList) {
    try {
      const params = new URLSearchParams({ req: q });
      if (opts.column) params.set("column", opts.column);
      const res = await f(`${mirror}/index.php?${params}`, { signal: opts.signal, redirect: "follow" } as RequestInit);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.includes("md5=")) continue;
      const best = pickBestLibgenRow(parseLibgenRows(text), {
        expectedDoi: opts.expectedDoi,
        expectedTitle: opts.expectedTitle ?? (opts.column === "title" ? q : undefined),
        column: opts.column,
      });
      if (!best) continue;
      const getUrl = await resolveLibgenGetUrl(f, mirror, best.md5, opts.signal);
      if (!getUrl) continue;
      const host = mirror.split("//").pop() ?? "libgen";
      out.push({
        kind: "url",
        url: getUrl,
        source: `libgen_${host}_${opts.column ?? "query"}`,
        priority: opts.priority,
      });
      if (best.ext === "pdf") break;
    } catch { /* 试下一镜像 */ }
  }
  return out;
}

export async function resolveLibgenUrls(
  doi: string,
  deps: { fetchImpl?: FetchImpl; signal?: AbortSignal; title?: string; mirrorSettings?: AltMirrorSettings },
): Promise<UrlCandidate[]> {
  const f = deps.fetchImpl ?? fetch;
  const d = normDoi(doi);
  const { ordered } = await orderMirrors("libgen", deps.mirrorSettings, { fetchImpl: f, signal: deps.signal });
  const out: UrlCandidate[] = [];
  const pickOpts = { expectedDoi: d, expectedTitle: deps.title, signal: deps.signal, mirrors: ordered };
  out.push(...await searchLibgen(f, d, { ...pickOpts, column: "doi", priority: 60 }));
  out.push(...await searchLibgen(f, d, { ...pickOpts, priority: 61 }));
  if (deps.title) {
    out.push(...await searchLibgen(f, deps.title, { ...pickOpts, column: "title", priority: 61 }));
    const short = deps.title.split(":")[0]?.trim();
    if (short && short !== deps.title && short.length > 12) {
      out.push(...await searchLibgen(f, short, { ...pickOpts, column: "title", priority: 62 }));
    }
  }
  return dedupeUrls(out);
}

async function searchAnnas(
  f: FetchImpl,
  doi: string,
  signal?: AbortSignal,
  mirrors?: string[],
): Promise<{ titles: string[]; md5s: string[] }> {
  const d = normDoi(doi);
  const titles: string[] = [];
  const md5s: string[] = [];
  for (const mirror of (mirrors?.length ? mirrors : getAnnasMirrors())) {
    for (const q of [`doi:${d}`, d]) {
      try {
        const res = await f(`${mirror}/search?q=${encodeURIComponent(q)}`, {
          signal,
          headers: { accept: "text/html" },
          redirect: "follow",
        } as RequestInit);
        if (!res.ok) continue;
        const html = await res.text();
        const dl = d.toLowerCase();
        for (const m of html.matchAll(/href="([^"]*\/md5\/[a-f0-9]{32}[^"]*)"/gi)) {
          const block = html.slice(Math.max(0, html.indexOf(m[0]) - 200), html.indexOf(m[0]) + 400).toLowerCase();
          if (block.includes(dl) || block.includes(`doi:${dl}`)) {
            const md5m = /\/md5\/([a-f0-9]{32})/i.exec(m[1]);
            if (md5m) md5s.push(md5m[1].toLowerCase());
          }
        }
        // 无 DOI 锚点的 md5 不采用，避免标题相似文献错配
        const titleMatches = html.match(/<a[^>]*href="[^"]*\/md5\/[^"]*"[^>]*>([^<]{10,})</gi) ?? [];
        for (const t of titleMatches.slice(0, 5)) {
          const text = stripHtml(t);
          if (text.length > 8) titles.push(text);
        }
        if (titles.length || md5s.length) break;
      } catch { /* 下一镜像 */ }
    }
    if (titles.length || md5s.length) break;
  }
  return { titles: [...new Set(titles)], md5s: [...new Set(md5s)] };
}

export async function resolveAnnasUrls(
  doi: string,
  deps: { fetchImpl?: FetchImpl; signal?: AbortSignal; title?: string; mirrorSettings?: AltMirrorSettings },
): Promise<UrlCandidate[]> {
  const f = deps.fetchImpl ?? fetch;
  const out: UrlCandidate[] = [];
  const [{ ordered: annasMirrors }, { ordered: libgenMirrors }] = await Promise.all([
    orderMirrors("annas", deps.mirrorSettings, { fetchImpl: f, signal: deps.signal }),
    orderMirrors("libgen", deps.mirrorSettings, { fetchImpl: f, signal: deps.signal }),
  ]);
  const { titles: annasTitles, md5s } = await searchAnnas(f, doi, deps.signal, annasMirrors);

  for (const md5 of md5s.slice(0, 3)) {
    for (const mirror of libgenMirrors) {
      const getUrl = await resolveLibgenGetUrl(f, mirror, md5, deps.signal);
      if (getUrl) {
        out.push({ kind: "url", url: getUrl, source: `annas_bridge_libgen_${mirror.split("//").pop()}`, priority: 59 });
        break;
      }
    }
  }

  const searchTitles = [...new Set([deps.title, ...annasTitles].filter(Boolean) as string[])];
  const pickOpts = { expectedDoi: doi, expectedTitle: deps.title, signal: deps.signal, mirrors: libgenMirrors };
  for (const t of searchTitles) {
    out.push(...await searchLibgen(f, t, { ...pickOpts, column: "title", priority: 61 }));
  }
  return dedupeUrls(out);
}

export function scihubCandidate(doi: string): PdfCandidate {
  return { kind: "scihub", doi: normDoi(doi), source: "scihub", priority: 70 };
}

function resolveHref(href: string, pageUrl: string): string {
  if (href.startsWith("//")) return `https:${href}`;
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return href;
  }
}

function extractPdfUrlFromHtml(html: string, pageUrl: string): string | null {
  const iframe = /<iframe[^>]+src="([^"]+)"/i.exec(html);
  if (iframe?.[1]) return resolveHref(iframe[1], pageUrl);
  const embed = /<embed[^>]+src="([^"]+)"/i.exec(html);
  if (embed?.[1]) return resolveHref(embed[1], pageUrl);
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"/gi)) {
    const href = m[1];
    if (/\.pdf/i.test(href) || /\/pdf$/i.test(href)) return resolveHref(href, pageUrl);
  }
  return null;
}

/** Sci-Hub 抓取（备选链末尾；返回 PDF 字节或 null） */
export async function fetchScihubPdf(
  doi: string,
  deps: { fetchImpl?: FetchImpl; signal?: AbortSignal; mirrors?: string[] } = {},
): Promise<{ bytes: Uint8Array; url: string } | null> {
  const f = deps.fetchImpl ?? fetch;
  const id = normDoi(doi);
  if (!DOI_RE.test(id) && !id.startsWith("http")) return null;

  const mirrors = deps.mirrors ?? getScihubMirrors();
  for (const base of mirrors) {
    const root = base.replace(/\/$/, "") + "/";
    try {
      const pageRes = await f(root + encodeURIComponent(id), {
        signal: deps.signal,
        redirect: "follow",
        headers: { accept: "text/html,application/pdf,*/*" },
      } as RequestInit);
      const pageUrl = pageRes.url;
      const ct = (pageRes.headers.get("content-type") ?? "").toLowerCase();
      if (ct.includes("application/pdf")) {
        const buf = new Uint8Array(await pageRes.arrayBuffer());
        return { bytes: buf, url: pageUrl };
      }
      const html = await pageRes.text();
      const pdfUrl = extractPdfUrlFromHtml(html, pageUrl);
      if (!pdfUrl) continue;
      const pdfRes = await f(pdfUrl, { signal: deps.signal, redirect: "follow" } as RequestInit);
      if (!pdfRes.ok) continue;
      const pdfCt = (pdfRes.headers.get("content-type") ?? "").toLowerCase();
      if (pdfCt && !pdfCt.includes("pdf") && !pdfCt.includes("octet-stream")) continue;
      return { bytes: new Uint8Array(await pdfRes.arrayBuffer()), url: pdfUrl };
    } catch { /* 下一镜像 */ }
  }
  return null;
}

export async function resolveAltUrlCandidates(
  doi: string,
  deps: { fetchImpl?: FetchImpl; signal?: AbortSignal; title?: string; includeScihub?: boolean; mirrorSettings?: AltMirrorSettings },
): Promise<PdfCandidate[]> {
  if (!doi) return [];
  const [libgen, annas] = await Promise.all([
    resolveLibgenUrls(doi, deps),
    resolveAnnasUrls(doi, deps),
  ]);
  const out: PdfCandidate[] = [...libgen, ...annas];
  if (deps.includeScihub !== false) out.push(scihubCandidate(doi));
  return out;
}
