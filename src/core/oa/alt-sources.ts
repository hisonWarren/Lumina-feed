// lumina-feed · 备选全文渠道（LibGen / Anna's Archive / Sci-Hub）
// 端口自「文献检索与PDF下载_实现资料」，与 OA 候选统一按 priority 排序。
import altMirrors from "./config/alt-mirrors.json" with { type: "json" };
import type { PdfCandidate, UrlCandidate } from "./candidate.ts";

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
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
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

function parseLibgenRows(html: string): { md5: string; ext: string }[] {
  const rows: { md5: string; ext: string }[] = [];
  for (const row of html.matchAll(ROW_RE)) {
    const md5m = MD5_RE.exec(row[1]);
    if (!md5m) continue;
    const cells = [...row[1].matchAll(CELL_RE)].map((c) => stripHtml(c[1]));
    if (cells.length < 8) continue;
    rows.push({ md5: md5m[1], ext: cells[7].toLowerCase() });
  }
  return rows;
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
  opts: { column?: string; priority: number; signal?: AbortSignal },
): Promise<UrlCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const out: UrlCandidate[] = [];
  for (const mirror of getLibgenMirrors()) {
    try {
      const params = new URLSearchParams({ req: q });
      if (opts.column) params.set("column", opts.column);
      const res = await f(`${mirror}/index.php?${params}`, { signal: opts.signal, redirect: "follow" } as RequestInit);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.includes("md5=")) continue;
      const rows = parseLibgenRows(text).filter((r) => r.ext === "pdf");
      const best = rows[0] ?? parseLibgenRows(text)[0];
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
  deps: { fetchImpl?: FetchImpl; signal?: AbortSignal; title?: string },
): Promise<UrlCandidate[]> {
  const f = deps.fetchImpl ?? fetch;
  const d = normDoi(doi);
  const out: UrlCandidate[] = [];
  out.push(...await searchLibgen(f, d, { column: "doi", priority: 60, signal: deps.signal }));
  out.push(...await searchLibgen(f, d, { priority: 61, signal: deps.signal }));
  if (deps.title) {
    out.push(...await searchLibgen(f, deps.title, { column: "title", priority: 61, signal: deps.signal }));
    const short = deps.title.split(":")[0]?.trim();
    if (short && short !== deps.title && short.length > 12) {
      out.push(...await searchLibgen(f, short, { column: "title", priority: 62, signal: deps.signal }));
    }
  }
  return dedupeUrls(out);
}

async function searchAnnas(
  f: FetchImpl,
  doi: string,
  signal?: AbortSignal,
): Promise<{ titles: string[]; md5s: string[] }> {
  const d = normDoi(doi);
  const titles: string[] = [];
  const md5s: string[] = [];
  for (const mirror of getAnnasMirrors()) {
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
        if (!md5s.length) {
          for (const m of html.matchAll(MD5_PATH_RE)) md5s.push(m[1].toLowerCase());
        }
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
  deps: { fetchImpl?: FetchImpl; signal?: AbortSignal; title?: string },
): Promise<UrlCandidate[]> {
  const f = deps.fetchImpl ?? fetch;
  const out: UrlCandidate[] = [];
  const { titles: annasTitles, md5s } = await searchAnnas(f, doi, deps.signal);

  for (const md5 of md5s.slice(0, 3)) {
    for (const mirror of getLibgenMirrors()) {
      const getUrl = await resolveLibgenGetUrl(f, mirror, md5, deps.signal);
      if (getUrl) {
        out.push({ kind: "url", url: getUrl, source: `annas_bridge_libgen_${mirror.split("//").pop()}`, priority: 59 });
        break;
      }
    }
  }

  const searchTitles = [...new Set([deps.title, ...annasTitles].filter(Boolean) as string[])];
  for (const t of searchTitles) {
    out.push(...await searchLibgen(f, t, { column: "title", priority: 61, signal: deps.signal }));
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
  deps: { fetchImpl?: FetchImpl; signal?: AbortSignal; title?: string; includeScihub?: boolean },
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
