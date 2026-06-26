// lumina-feed · PDF 候选解析（OA + 备选渠道统一排序，不区分类别）
// 聚合实现资料 oa_sources + alt_sources + Sci-Hub，按 priority 一条链顺序尝试。
import type { Paper } from "../model.ts";
import publisherRules from "./config/publisher-rules.json" with { type: "json" };
import { dedupeCandidates, type PdfCandidate, type UrlCandidate } from "./candidate.ts";
import { resolveAltUrlCandidates } from "./alt-sources.ts";
import { isLegitimateOaUrl } from "../summarize/oa-guard.ts";

export interface ResolveDeps {
  email?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** 关闭某些 OA 元数据源（默认全开） */
  use?: {
    unpaywall?: boolean;
    openalex?: boolean;
    europepmc?: boolean;
    crossref?: boolean;
    semanticScholar?: boolean;
    altSources?: boolean;
    scihub?: boolean;
  };
  /** false 时仅保留 isLegitimateOaUrl 候选（默认 true：与 OA 同一顺序链） */
  includeAltSources?: boolean;
}

const normDoi = (doi?: string) => doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");

async function getJson(url: string, f: typeof fetch, signal?: AbortSignal): Promise<any | null> {
  try {
    const res = await f(url, { headers: { accept: "application/json" }, signal, redirect: "follow" } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function doiParts(doi: string): { prefix: string; suffix: string } {
  const i = doi.indexOf("/");
  return i >= 0 ? { prefix: doi.slice(0, i), suffix: doi.slice(i + 1) } : { prefix: "", suffix: doi };
}

function fromPublisherRules(doi: string, paper: Paper): UrlCandidate[] {
  const { prefix, suffix } = doiParts(doi);
  const out: UrlCandidate[] = [];
  for (const rule of publisherRules as { prefix?: string; pdf_urls?: string[]; priority?: number }[]) {
    const rp = rule.prefix ?? "";
    if (rp === "PMC") {
      if (paper.pmcid) {
        const num = paper.pmcid.replace(/^PMC/i, "");
        for (const tpl of rule.pdf_urls ?? []) {
          out.push({
            kind: "url",
            url: tpl.replace("{pmcid}", num).replace("{suffix}", suffix).replace("{doi}", doi),
            source: `publisher_${rp}`,
            priority: rule.priority ?? 50,
          });
        }
      }
      continue;
    }
    if (rp && !prefix.startsWith(rp)) continue;
    for (const tpl of rule.pdf_urls ?? []) {
      out.push({
        kind: "url",
        url: tpl.replace("{suffix}", suffix).replace("{doi}", doi),
        source: `publisher_${rp || "generic"}`,
        priority: rule.priority ?? 50,
      });
    }
  }
  return out;
}

function fromIdentifiers(paper: Paper): UrlCandidate[] {
  const out: UrlCandidate[] = [];
  if (paper.oaUrl) out.push({ kind: "url", url: paper.oaUrl, source: "paper_oa_url", priority: 4 });
  if (paper.pmcid) {
    const num = paper.pmcid.replace(/^PMC/i, "");
    out.push({ kind: "url", url: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${num}/pdf/`, source: "pmc_identifier", priority: 35 });
    out.push({ kind: "url", url: `https://europepmc.org/backend/ptpmcrender?ftid=PMC${num}&fileformat=pdf`, source: "europepmc_render", priority: 20 });
  }
  if (paper.arxivId) out.push({ kind: "url", url: `https://arxiv.org/pdf/${paper.arxivId}`, source: "arxiv_identifier", priority: 6 });
  return out;
}

function fromArxivDoi(doi: string): UrlCandidate[] {
  const m = /arxiv\.(\d+\.\d+(v\d+)?)/i.exec(doi);
  if (!m) return [];
  return [{ kind: "url", url: `https://arxiv.org/pdf/${m[1]}`, source: "arxiv_doi", priority: 6 }];
}

function fromElife(doi: string): UrlCandidate[] {
  if (!doi.startsWith("10.7554/")) return [];
  const suffix = doiParts(doi).suffix;
  const m = /(\d+)\s*$/.exec(suffix);
  const id = m?.[1] ?? suffix.replace(/elife\./i, "");
  return [
    { kind: "url", url: `https://cdn.elifesciences.org/articles/${id}/elife-${id}-v1.pdf`, source: "elife_cdn", priority: 10 },
    { kind: "url", url: `https://elifesciences.org/articles/${id}.pdf`, source: "elife", priority: 11 },
  ];
}

function fromFrontiers(doi: string): UrlCandidate[] {
  if (!doi.startsWith("10.3389/")) return [];
  return [{ kind: "url", url: `https://www.frontiersin.org/articles/${doi}/pdf`, source: "frontiers", priority: 12 }];
}

function fromPlos(doi: string): UrlCandidate[] {
  if (!doi.startsWith("10.1371/")) return [];
  const journalMap: Record<string, string> = {
    "journal.pone": "plosone",
    "journal.pbio": "plosbiology",
    "journal.pmed": "plosmedicine",
  };
  for (const [key, slug] of Object.entries(journalMap)) {
    if (doi.includes(key)) {
      return [{
        kind: "url",
        url: `https://journals.plos.org/${slug}/article/file?id=${doi}&type=printable`,
        source: "plos",
        priority: 11,
      }];
    }
  }
  return [];
}

async function fromUnpaywall(doi: string, deps: ResolveDeps): Promise<UrlCandidate[]> {
  if (!deps.email || deps.use?.unpaywall === false) return [];
  const f = deps.fetchImpl ?? fetch;
  const data = await getJson(
    `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(deps.email)}`,
    f,
    deps.signal,
  );
  if (!data) return [];
  const out: UrlCandidate[] = [];
  const best = data.best_oa_location;
  if (best?.url_for_pdf) out.push({ kind: "url", url: best.url_for_pdf, source: "unpaywall_best", priority: 5 });
  else if (best?.url) out.push({ kind: "url", url: best.url, source: "unpaywall_best_landing", priority: 8 });
  for (const [i, loc] of (data.oa_locations ?? []).entries()) {
    if (loc.url_for_pdf) out.push({ kind: "url", url: loc.url_for_pdf, source: `unpaywall_loc_${i}`, priority: 12 + i });
    else if (loc.url) out.push({ kind: "url", url: loc.url, source: `unpaywall_loc_${i}_html`, priority: 15 + i });
  }
  return out;
}

async function fromOpenalex(doi: string, deps: ResolveDeps): Promise<UrlCandidate[]> {
  if (deps.use?.openalex === false) return [];
  const f = deps.fetchImpl ?? fetch;
  const mailto = deps.email ? `?mailto=${encodeURIComponent(deps.email)}` : "";
  const data = await getJson(`https://api.openalex.org/works/https://doi.org/${doi}${mailto}`, f, deps.signal);
  if (!data) return [];
  const out: UrlCandidate[] = [];
  const best = data.best_oa_location;
  if (best?.pdf_url) out.push({ kind: "url", url: best.pdf_url, source: "openalex_best_pdf", priority: 7 });
  else if (best?.landing_page_url) out.push({ kind: "url", url: best.landing_page_url, source: "openalex_best_landing", priority: 8 });
  if (data.open_access?.oa_url) out.push({ kind: "url", url: data.open_access.oa_url, source: "openalex_oa_url", priority: 10 });
  if (data.primary_location?.pdf_url) out.push({ kind: "url", url: data.primary_location.pdf_url, source: "openalex_pdf", priority: 7 });
  for (const [i, loc] of (data.locations ?? []).entries()) {
    if (loc.pdf_url) out.push({ kind: "url", url: loc.pdf_url, source: `openalex_loc_${i}`, priority: 18 + i });
    else if (loc.landing_page_url) out.push({ kind: "url", url: loc.landing_page_url, source: `openalex_loc_${i}_html`, priority: 20 + i });
  }
  return out;
}

async function fromSemanticScholar(doi: string, deps: ResolveDeps): Promise<UrlCandidate[]> {
  if (deps.use?.semanticScholar === false) return [];
  const f = deps.fetchImpl ?? fetch;
  const data = await getJson(
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf`,
    f,
    deps.signal,
  );
  const url = data?.openAccessPdf?.url;
  return url ? [{ kind: "url", url, source: "semantic_scholar", priority: 9 }] : [];
}

async function fromEuropePmc(doi: string, deps: ResolveDeps): Promise<{ cands: UrlCandidate[]; title?: string }> {
  if (deps.use?.europepmc === false) return { cands: [] };
  const f = deps.fetchImpl ?? fetch;
  const data = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:${encodeURIComponent(doi)}&format=json&pageSize=1&resultType=core`,
    f,
    deps.signal,
  );
  const hit = data?.resultList?.result?.[0];
  if (!hit) return { cands: [] };
  const out: UrlCandidate[] = [];
  const pmcid = hit.pmcid as string | undefined;
  if (pmcid) {
    const num = pmcid.replace(/^PMC/i, "");
    out.push({ kind: "url", url: `https://europepmc.org/backend/ptpmcrender?ftid=PMC${num}&fileformat=pdf`, source: "europepmc_render", priority: 20 });
    out.push({ kind: "url", url: `https://europepmc.org/articles/${pmcid}/pdf`, source: "europepmc_article_pdf", priority: 22 });
    out.push({ kind: "url", url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/pdf/`, source: "pmc_ncbi_pdf", priority: 35 });
  }
  for (const link of hit.fullTextUrlList?.fullTextUrl ?? []) {
    if (String(link.documentStyle ?? "").toLowerCase() === "pdf" && link.url) {
      out.push({ kind: "url", url: link.url, source: "europepmc_fulltext_list", priority: 15 });
    }
  }
  return { cands: out, title: hit.title as string | undefined };
}

async function fromCrossref(doi: string, deps: ResolveDeps): Promise<{ cands: UrlCandidate[]; title?: string }> {
  if (deps.use?.crossref === false) return { cands: [] };
  const f = deps.fetchImpl ?? fetch;
  const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, f, deps.signal);
  const item = data?.message;
  if (!item) return { cands: [] };
  const out: UrlCandidate[] = [];
  for (const link of item.link ?? []) {
    const ct = String(link["content-type"] ?? "").toLowerCase();
    if (ct.includes("pdf") && link.URL) {
      out.push({ kind: "url", url: link.URL, source: "crossref_link", priority: 25 });
    }
  }
  return { cands: out, title: (item.title ?? [])[0] as string | undefined };
}

/** 统一候选链：OA + LibGen + Anna + Sci-Hub，按 priority 排序 */
export async function resolvePdfCandidates(paper: Paper, deps: ResolveDeps = {}): Promise<PdfCandidate[]> {
  const doi = normDoi(paper.doi);
  const includeAlt = deps.includeAltSources !== false;
  const all: PdfCandidate[] = [...fromIdentifiers(paper)];

  if (doi) {
    all.push(...fromPublisherRules(doi, paper));
    all.push(...fromArxivDoi(doi));
    all.push(...fromElife(doi));
    all.push(...fromFrontiers(doi));
    all.push(...fromPlos(doi));

    const settled = await Promise.allSettled([
      fromUnpaywall(doi, deps),
      fromOpenalex(doi, deps),
      fromSemanticScholar(doi, deps),
      fromEuropePmc(doi, deps),
      fromCrossref(doi, deps),
    ]);

    let title = paper.title;
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      if (Array.isArray(s.value)) all.push(...s.value);
      else {
        all.push(...s.value.cands);
        if (!title && s.value.title) title = s.value.title;
      }
    }

    if (includeAlt && deps.use?.altSources !== false) {
      const alt = await resolveAltUrlCandidates(doi, {
        fetchImpl: deps.fetchImpl,
        signal: deps.signal,
        title,
        includeScihub: deps.use?.scihub !== false,
      });
      all.push(...alt);
    }
  }

  let merged = dedupeCandidates(all);
  if (!includeAlt) {
    merged = merged.filter((c) => c.kind === "scihub" ? false : isLegitimateOaUrl(c.url));
  }
  return merged;
}

/** 兼容旧接口：仅 URL 字符串列表 */
export async function resolveOa(paper: Paper, deps: ResolveDeps = {}): Promise<string[]> {
  const cands = await resolvePdfCandidates(paper, deps);
  return cands.filter((c): c is UrlCandidate => c.kind === "url").map((c) => c.url);
}
