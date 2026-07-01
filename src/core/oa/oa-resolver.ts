// lumina-feed · PDF 候选解析（OA + LibGen + Anna + Sci-Hub 统一链）
import type { Paper } from "../model.ts";
import type { AltMirrorSettings } from "./alt-sources.ts";
import type { FetchTraceStatus } from "./fetch-trace.ts";
import { dedupeCandidates, type PdfCandidate, type UrlCandidate } from "./candidate.ts";
import { resolveLibgenUrls, resolveAnnasUrls } from "./alt-sources.ts";
import { isLegitimateOaUrl } from "../summarize/oa-guard.ts";
import {
  fromCore, fromDoaj, fromHal, fromZenodo, fromDatacite,
} from "./oa-extended.ts";
import { osfDoiDownloadUrl } from "../sources/osf-preprints.ts";
import { normalizeOaFetchUrl } from "./oa-url-normalize.ts";
import { biorxivApiPdfCandidates, isBiorxivDoi } from "./biorxiv-resolve.ts";
import { chemrxivPdfCandidates } from "./chemrxiv-resolve.ts";
import { figsharePdfCandidates } from "./figshare-resolve.ts";
import { isNonAutomatableLandingUrl } from "./landing-hosts.ts";
import publisherRules from "./config/publisher-rules.json" with { type: "json" };

export interface ResolveDeps {
  email?: string;
  coreKey?: string;
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
  /** false 时仅保留 isLegitimateOaUrl 候选（默认 true：含备选渠道） */
  includeAltSources?: boolean;
  mirrorSettings?: AltMirrorSettings;
  onTrace?: (stepId: string, status: FetchTraceStatus, detail?: string, ms?: number) => void;
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
  if (paper.oaUrl) {
    const url = normalizeOaFetchUrl(paper.oaUrl);
    if (url) out.push({ kind: "url", url, source: "paper_oa_url", priority: 4 });
  }
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

function fromOsfDoi(doi: string): UrlCandidate[] {
  const url = osfDoiDownloadUrl(doi);
  return url ? [{ kind: "url", url, source: "osf_download", priority: 5 }] : [];
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
  else if (best?.url && !isNonAutomatableLandingUrl(best.url)) {
    out.push({ kind: "url", url: best.url, source: "unpaywall_best_landing", priority: 8 });
  }
  for (const [i, loc] of (data.oa_locations ?? []).entries()) {
    if (loc.url_for_pdf) out.push({ kind: "url", url: loc.url_for_pdf, source: `unpaywall_loc_${i}`, priority: 12 + i });
    else if (loc.url && !isNonAutomatableLandingUrl(loc.url)) {
      out.push({ kind: "url", url: loc.url, source: `unpaywall_loc_${i}_html`, priority: 15 + i });
    }
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
  else if (best?.landing_page_url && !isNonAutomatableLandingUrl(best.landing_page_url)) {
    out.push({ kind: "url", url: best.landing_page_url, source: "openalex_best_landing", priority: 8 });
  }
  if (data.open_access?.oa_url && !isNonAutomatableLandingUrl(data.open_access.oa_url)) {
    out.push({ kind: "url", url: data.open_access.oa_url, source: "openalex_oa_url", priority: 10 });
  }
  if (data.primary_location?.pdf_url) out.push({ kind: "url", url: data.primary_location.pdf_url, source: "openalex_pdf", priority: 7 });
  for (const [i, loc] of (data.locations ?? []).entries()) {
    if (loc.pdf_url) out.push({ kind: "url", url: loc.pdf_url, source: `openalex_loc_${i}`, priority: 18 + i });
    else if (loc.landing_page_url && !isNonAutomatableLandingUrl(loc.landing_page_url)) {
      out.push({ kind: "url", url: loc.landing_page_url, source: `openalex_loc_${i}_html`, priority: 20 + i });
    }
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
  if (!url || isNonAutomatableLandingUrl(url)) return [];
  return [{ kind: "url", url, source: "semantic_scholar", priority: 9 }];
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
  const trace = deps.onTrace;
  const timed = async (stepId: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    trace?.(stepId, "running");
    try {
      const v = await fn();
      trace?.(stepId, "ok", undefined, Date.now() - t0);
      return v;
    } catch (e) {
      trace?.(stepId, "fail", String((e as Error)?.message || e), Date.now() - t0);
      throw e;
    }
  };

  trace?.("identifiers", "running");
  const all: PdfCandidate[] = [...fromIdentifiers(paper)];
  trace?.("identifiers", all.length ? "ok" : "skip", all.length ? `${all.length} 个` : undefined);

  if (doi) {
    all.push(...fromPublisherRules(doi, paper));
    all.push(...fromArxivDoi(doi));
    all.push(...fromElife(doi));
    all.push(...fromFrontiers(doi));
    all.push(...fromPlos(doi));

    const settled = await Promise.allSettled([
      timed("biorxiv_api", () => biorxivApiPdfCandidates(doi, deps.fetchImpl, deps.signal)),
      timed("chemrxiv_api", () => chemrxivPdfCandidates(doi, deps.fetchImpl, deps.signal)),
      timed("figshare_api", () => figsharePdfCandidates(doi, deps.fetchImpl, deps.signal)),
      timed("unpaywall", () => fromUnpaywall(doi, deps)),
      timed("openalex", () => fromOpenalex(doi, deps)),
      timed("extended", () => fromSemanticScholar(doi, deps)),
      timed("europepmc", () => fromEuropePmc(doi, deps)),
      timed("crossref", () => fromCrossref(doi, deps)),
      timed("extended", () => fromDoaj(doi, deps.fetchImpl ?? fetch, deps.signal)),
      timed("extended", () => fromHal(doi, deps.fetchImpl ?? fetch, deps.signal)),
      timed("extended", () => fromZenodo(doi, deps.fetchImpl ?? fetch, deps.signal)),
      timed("extended", () => fromDatacite(doi, deps.fetchImpl ?? fetch, deps.signal)),
      timed("extended", () => fromCore(doi, deps.fetchImpl ?? fetch, deps.signal, deps.coreKey)),
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
      const hasDirectArxiv = !!paper.arxivId || !!(doi && /arxiv\.\d+\.\d+/i.test(doi));
      if (!hasDirectArxiv) {
        trace?.("libgen", "running");
        const tL = Date.now();
        let libgenPart: PdfCandidate[] = [];
        let annasPart: PdfCandidate[] = [];
        try {
          [libgenPart, annasPart] = await Promise.all([
            resolveLibgenUrls(doi, { fetchImpl: deps.fetchImpl, signal: deps.signal, title, mirrorSettings: deps.mirrorSettings }).then((r) => {
              trace?.("libgen", r.length ? "ok" : "fail", r.length ? `${r.length} 候选` : "无匹配", Date.now() - tL);
              return r;
            }),
            resolveAnnasUrls(doi, { fetchImpl: deps.fetchImpl, signal: deps.signal, title, mirrorSettings: deps.mirrorSettings }).then((r) => {
              trace?.("annas", r.length ? "ok" : "fail", r.length ? `${r.length} 候选` : "无匹配");
              return r;
            }),
          ]);
        } catch {
          trace?.("libgen", "fail");
          trace?.("annas", "fail");
        }
        all.push(...libgenPart, ...annasPart);
      } else {
        trace?.("libgen", "skip", "arxiv 直达");
        trace?.("annas", "skip", "arxiv 直达");
      }
      if (doi && deps.use?.scihub !== false) {
        trace?.("scihub", "ok", "已加入候选");
        all.push({ kind: "scihub", doi, source: "scihub", priority: 70 });
      } else {
        trace?.("scihub", "skip");
      }
    } else {
      trace?.("libgen", "skip");
      trace?.("annas", "skip");
      trace?.("scihub", "skip");
    }
  }

  let merged = dedupeCandidates(all);
  if (doi && isBiorxivDoi(doi)) {
    merged = merged.filter(
      (c) => !(c.kind === "url" && /unpaywall/.test(c.source) && /biorxiv|medrxiv/i.test(c.url)),
    );
    merged = dedupeCandidates(merged);
  }
  if (!includeAlt) {
    merged = merged.filter((c) => c.kind === "scihub" ? false : isLegitimateOaUrl(c.url));
  }
  return merged;
}

/** 同步直链候选（paper.oaUrl / PMC / arXiv / 出版商规则）——不等待元数据 API */
export function immediatePdfCandidates(paper: Paper): PdfCandidate[] {
  const doi = normDoi(paper.doi);
  const all: PdfCandidate[] = [...fromIdentifiers(paper)];
  if (doi) {
    all.push(...fromPublisherRules(doi, paper));
    all.push(...fromArxivDoi(doi));
    all.push(...fromOsfDoi(doi));
    all.push(...fromElife(doi));
    all.push(...fromFrontiers(doi));
    all.push(...fromPlos(doi));
  }
  return dedupeCandidates(all);
}

/** 仅备用库候选（LibGen / Anna / Sci-Hub） */
export async function resolveAltPdfCandidates(paper: Paper, deps: ResolveDeps = {}): Promise<PdfCandidate[]> {
  const doi = normDoi(paper.doi);
  const trace = deps.onTrace;
  const all: PdfCandidate[] = [];
  if (!doi || deps.includeAltSources === false || deps.use?.altSources === false) return all;

  let title = paper.title;
  const hasDirectArxiv = !!paper.arxivId || !!(doi && /arxiv\.\d+\.\d+/i.test(doi));
  if (!hasDirectArxiv) {
    trace?.("libgen", "running");
    const tL = Date.now();
    let libgenPart: PdfCandidate[] = [];
    let annasPart: PdfCandidate[] = [];
    try {
      [libgenPart, annasPart] = await Promise.all([
        resolveLibgenUrls(doi, { fetchImpl: deps.fetchImpl, signal: deps.signal, title, mirrorSettings: deps.mirrorSettings }).then((r) => {
          trace?.("libgen", r.length ? "ok" : "fail", r.length ? `${r.length} 候选` : "无匹配", Date.now() - tL);
          return r;
        }),
        resolveAnnasUrls(doi, { fetchImpl: deps.fetchImpl, signal: deps.signal, title, mirrorSettings: deps.mirrorSettings }).then((r) => {
          trace?.("annas", r.length ? "ok" : "fail", r.length ? `${r.length} 候选` : "无匹配");
          return r;
        }),
      ]);
    } catch {
      trace?.("libgen", "fail");
      trace?.("annas", "fail");
    }
    all.push(...libgenPart, ...annasPart);
  } else {
    trace?.("libgen", "skip", "arxiv 直达");
    trace?.("annas", "skip", "arxiv 直达");
  }
  if (doi && deps.use?.scihub !== false) {
    trace?.("scihub", "ok", "已加入候选");
    all.push({ kind: "scihub", doi, source: "scihub", priority: 70 });
  } else {
    trace?.("scihub", "skip");
  }
  return dedupeCandidates(all);
}

/** 兼容旧接口：仅 URL 字符串列表 */
export async function resolveOa(paper: Paper, deps: ResolveDeps = {}): Promise<string[]> {
  const cands = await resolvePdfCandidates(paper, deps);
  return cands.filter((c): c is UrlCandidate => c.kind === "url").map((c) => c.url);
}
