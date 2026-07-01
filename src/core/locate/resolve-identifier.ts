// locate · 标识符解析车道（A）— 并行 metadata，不经过 17 源 aggregate
import type { Paper } from "../model.ts";
import type { SearchHit } from "../model.ts";
import type { SearchOpts } from "../sources/adapter.ts";
import { getJson, getText, getPoliteIdentity } from "../sources/adapter.ts";
import { parseCrossref } from "../sources/crossref.ts";
import { parseOpenalex, reconstructAbstract } from "../sources/openalex.ts";
import { parsePubmedSummary } from "../sources/pubmed.ts";
import { parseArxivAtom } from "../sources/arxiv.ts";
import { normalize } from "../normalize.ts";
import { withTimeout, TimeoutError } from "../sources/with-timeout.ts";
import { parseIdentifier, type ParsedIdentifier } from "./parse-identifier.ts";
import { mergeMetadataHits } from "./merge-metadata.ts";

const META_TIMEOUT_MS = 8000;
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export interface LocateResolveResult {
  ok: true;
  paper: Paper;
  resolvedFrom: string[];
  identifier: ParsedIdentifier;
  locateMode: "identifier";
}

export interface LocateResolveFailure {
  ok: false;
  reason: "not_identifier" | "not_found" | "timeout" | "error";
  message?: string;
  identifier?: ParsedIdentifier;
}

export type LocateResolveResponse = LocateResolveResult | LocateResolveFailure;

function parseOpenalexWork(json: any): SearchHit | null {
  if (!json?.id && !json?.doi) return null;
  const w = json;
  const isPreprint = w.type === "preprint" || w.primary_location?.version === "submittedVersion";
  const hit: SearchHit = {
    source: "openalex",
    doi: (w.doi ?? "").replace(/^https?:\/\/doi\.org\//, "").toLowerCase() || undefined,
    title: w.title || w.display_name,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
    journal: w.primary_location?.source?.display_name,
    year: w.publication_year,
    pubDate: w.publication_date,
    isPreprint,
    peerReviewed: !isPreprint,
    retracted: !!w.is_retracted,
    citationCount: w.cited_by_count,
    oaStatus: w.open_access?.oa_status,
    oaUrl: w.best_oa_location?.pdf_url || w.primary_location?.pdf_url || w.open_access?.oa_url || undefined,
  };
  return hit.title ? hit : null;
}

async function timed<T>(label: string, p: Promise<T>): Promise<{ label: string; value: T | null; error?: string }> {
  try {
    const value = await withTimeout(p, META_TIMEOUT_MS);
    return { label, value };
  } catch (e) {
    const msg = e instanceof TimeoutError ? "timeout" : String((e as Error)?.message || e);
    return { label, value: null, error: msg };
  }
}

async function resolveDoi(doi: string, opts: SearchOpts): Promise<{ hit: SearchHit | null; from: string[] }> {
  const mail = getPoliteIdentity().email;
  const mailQ = mail ? `?mailto=${encodeURIComponent(mail)}` : "";
  const enc = encodeURIComponent(doi);

  const [cr, oa] = await Promise.all([
    timed("crossref", getJson(`https://api.crossref.org/works/${enc}`, opts).then((j) => {
      const items = j?.message ? [j.message] : [];
      return parseCrossref({ message: { items } })[0] ?? null;
    })),
    timed("openalex", getJson(`https://api.openalex.org/works/https://doi.org/${enc}${mailQ}`, opts).then(parseOpenalexWork)),
  ]);

  const hits: SearchHit[] = [];
  const from: string[] = [];
  if (cr.value) { hits.push(cr.value); from.push("crossref"); }
  if (oa.value) { hits.push(oa.value); from.push("openalex"); }
  return { hit: mergeMetadataHits(hits, "resolve"), from };
}

async function resolvePmid(pmid: string, opts: SearchOpts): Promise<{ hit: SearchHit | null; from: string[] }> {
  const { tool, email } = getPoliteIdentity();
  const ss = new URLSearchParams({ db: "pubmed", id: pmid, retmode: "json" });
  if (tool) ss.set("tool", tool);
  if (email) ss.set("email", email);
  if (opts.keys?.ncbi) ss.set("api_key", opts.keys.ncbi);

  const sum = await timed("pubmed", getJson(`${EUTILS}/esummary.fcgi?${ss}`, opts));
  if (!sum.value) return { hit: null, from: [] };
  const hit = parsePubmedSummary(sum.value)[0] ?? null;
  return { hit, from: hit ? ["pubmed"] : [] };
}

async function resolveArxiv(arxivId: string, opts: SearchOpts): Promise<{ hit: SearchHit | null; from: string[] }> {
  const p = new URLSearchParams({ id_list: arxivId, max_results: "1" });
  const xml = await timed("arxiv", getText(`${"https://export.arxiv.org/api/query"}?${p}`, opts));
  if (!xml.value) return { hit: null, from: [] };
  const hit = parseArxivAtom(xml.value)[0] ?? null;
  return { hit, from: hit ? ["arxiv"] : [] };
}

async function resolvePmcid(pmcid: string, opts: SearchOpts): Promise<{ hit: SearchHit | null; from: string[] }> {
  const id = pmcid.toUpperCase();
  const xml = await timed("europepmc", getText(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=PMCID:${id}&format=json&pageSize=1`,
    opts,
  ).then(async () => {
    const res = await (opts.fetchImpl ?? fetch)(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=PMCID:${id}&format=json&pageSize=1`,
      { headers: { accept: "application/json" }, signal: opts.signal },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }));

  if (!xml.value) return { hit: null, from: [] };
  const r = xml.value?.resultList?.result?.[0];
  if (!r) return { hit: null, from: [] };
  const hit: SearchHit = {
    source: "europepmc",
    pmcid: id,
    pmid: r.pmid,
    doi: r.doi ? String(r.doi).toLowerCase() : undefined,
    title: r.title,
    authors: r.authorString ? String(r.authorString).split(", ").filter(Boolean) : [],
    journal: r.journalTitle,
    year: r.pubYear ? Number(r.pubYear) : undefined,
    pubDate: r.firstPublicationDate,
    isPreprint: false,
    peerReviewed: true,
    oaUrl: r.pmcid ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${r.pmcid}/pdf/` : undefined,
    oaStatus: r.isOpenAccess === "Y" ? "green" : undefined,
  };
  return { hit: hit.title ? hit : null, from: hit.title ? ["europepmc"] : [] };
}

/** 解析标识符 → Paper（Lane A） */
export async function resolveIdentifierInput(
  raw: string,
  opts: SearchOpts = {},
): Promise<LocateResolveResponse> {
  const id = parseIdentifier(raw);
  if (!id) return { ok: false, reason: "not_identifier" };

  try {
    let hit: SearchHit | null = null;
    let from: string[] = [];

    if (id.kind === "doi") {
      ({ hit, from } = await resolveDoi(id.normalized, opts));
    } else if (id.kind === "pmid") {
      ({ hit, from } = await resolvePmid(id.normalized, opts));
    } else if (id.kind === "arxiv") {
      ({ hit, from } = await resolveArxiv(id.normalized, opts));
    } else if (id.kind === "pmcid") {
      ({ hit, from } = await resolvePmcid(id.normalized, opts));
    }

    if (!hit?.title) {
      if (id.kind === "doi") {
        hit = {
          source: "resolve",
          doi: id.normalized,
          title: `DOI ${id.normalized}`,
          authors: [],
          isPreprint: false,
          peerReviewed: false,
        };
        from = ["doi_stub"];
      } else {
        return { ok: false, reason: "not_found", identifier: id, message: "未找到该标识符的元数据" };
      }
    }

    const paper = normalize(hit);
    return { ok: true, paper, resolvedFrom: from, identifier: id, locateMode: "identifier" };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/timeout/i.test(msg)) return { ok: false, reason: "timeout", identifier: id, message: msg };
    return { ok: false, reason: "error", identifier: id, message: msg };
  }
}

export { parseIdentifier, classifyInput } from "./parse-identifier.ts";
