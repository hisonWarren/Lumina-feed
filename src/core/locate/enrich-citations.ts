// 检索结果回填被引次数：多源检索里 PubMed/Zenodo/DOAJ 等常不带 cites，按 DOI 向 OpenAlex 补查。
import type { Paper } from "../model.ts";
import type { SearchOpts } from "../sources/adapter.ts";
import { getPoliteIdentity } from "../sources/adapter.ts";
import { normDoi } from "../dedupe-keys.ts";

const MAX_ENRICH = 48;
const CHUNK = 8;

export async function enrichCitationCounts(papers: Paper[], opts: SearchOpts = {}): Promise<Paper[]> {
  const targets = papers.filter((p) => p.doi && p.citationCount == null);
  if (!targets.length) return papers;

  const dois = [...new Set(targets.map((p) => normDoi(p.doi!)).filter(Boolean))].slice(0, MAX_ENRICH) as string[];
  if (!dois.length) return papers;

  const f = opts.fetchImpl ?? fetch;
  const { email } = getPoliteIdentity();
  const byDoi = new Map<string, number>();

  for (let i = 0; i < dois.length; i += CHUNK) {
    const chunk = dois.slice(i, i + CHUNK);
    const filter = `doi:${chunk.join("|")}`;
    const p = new URLSearchParams({ filter, "per-page": String(chunk.length) });
    if (email) p.set("mailto", email);
    try {
      const res = await f(`https://api.openalex.org/works?${p}`, {
        headers: { accept: "application/json" },
        signal: opts.signal,
      });
      if (!res.ok) continue;
      const json = await res.json();
      for (const w of json.results ?? []) {
        const d = normDoi(String(w.doi ?? "").replace(/^https?:\/\/doi\.org\//, ""));
        if (d && w.cited_by_count != null) byDoi.set(d, Number(w.cited_by_count));
      }
    } catch { /* 单批失败不阻断 */ }
  }

  if (!byDoi.size) return papers;
  return papers.map((p) => {
    if (p.citationCount != null || !p.doi) return p;
    const c = byDoi.get(normDoi(p.doi)!);
    return c == null ? p : { ...p, citationCount: c };
  });
}
