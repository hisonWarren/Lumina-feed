// locate · 影子库命中元数据回填（P6 guarded）
// 仅当 LibGen/Anna 命中缺 DOI/摘要/作者时，用 Crossref 标题检索补全；Jaccard ≥ 0.92 才合并。
import type { Paper } from "../model.ts";
import type { SearchOpts } from "../sources/adapter.ts";
import { titleFingerprint } from "../dedupe.ts";
import { parseCrossref } from "../sources/crossref.ts";

const SCRAPE_SOURCES = new Set(["libgen", "annas"]);

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function isSparse(p: Paper): boolean {
  const fromScrape = SCRAPE_SOURCES.has(p.source)
    || p.versions.some((v) => SCRAPE_SOURCES.has(v.source));
  if (!fromScrape) return false;
  return !p.doi || !p.abstract?.trim() || !(p.authors?.length);
}

async function crossrefByTitle(title: string, opts: SearchOpts): Promise<Partial<Paper> | null> {
  const f = opts.fetchImpl ?? fetch;
  const fp = titleFingerprint(title);
  if (!fp || fp.length < 8) return null;
  const q = new URLSearchParams({ "query.title": title.trim(), rows: "5" });
  try {
    const res = await f(`https://api.crossref.org/works?${q}`, {
      headers: { accept: "application/json" },
      signal: opts.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const hits = parseCrossref(json);
    let best: (typeof hits)[0] | null = null;
    let bestScore = 0;
    for (const h of hits) {
      const score = jaccard(fp, titleFingerprint(h.title || ""));
      if (score > bestScore) { bestScore = score; best = h; }
    }
    if (!best || bestScore < 0.92) return null;
    return {
      doi: best.doi,
      abstract: best.abstract,
      authors: best.authors,
      journal: best.journal,
      year: best.year,
      pubDate: best.pubDate,
      oaStatus: best.oaStatus,
      oaUrl: best.oaUrl,
    };
  } catch {
    return null;
  }
}

/** 对稀疏影子库命中做 guarded 回填（并行，失败静默） */
export async function enrichSparsePapers(papers: Paper[], opts: SearchOpts = {}): Promise<Paper[]> {
  const targets = papers.filter(isSparse);
  if (!targets.length) return papers;

  const patches = new Map<string, Partial<Paper>>();
  await Promise.all(targets.map(async (p) => {
    const patch = await crossrefByTitle(p.title, opts);
    if (patch) patches.set(p.id, patch);
  }));

  if (!patches.size) return papers;
  return papers.map((p) => {
    const patch = patches.get(p.id);
    if (!patch) return p;
    return {
      ...p,
      doi: p.doi ?? patch.doi,
      abstract: p.abstract?.trim() ? p.abstract : patch.abstract,
      authors: p.authors?.length ? p.authors : (patch.authors ?? p.authors),
      journal: p.journal ?? patch.journal,
      year: p.year ?? patch.year,
      pubDate: p.pubDate ?? patch.pubDate,
      oaStatus: p.oaStatus ?? patch.oaStatus,
      oaUrl: p.oaUrl ?? patch.oaUrl,
    };
  });
}

export { jaccard, titleFingerprint };
