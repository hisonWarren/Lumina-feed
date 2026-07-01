// lumina-feed · bioRxiv / medRxiv 适配器
// 诚实局限：bioRxiv 官方 API 是「日期窗口」拉取，无关键词检索。
// 策略：用 details API 取近窗 preprint → 客户端按 QuerySpec 词过滤。
// 关键词级 preprint 发现更稳的路径其实是 Europe PMC(PPR)/Crossref(posted-content)，二者已覆盖。
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { toTermList } from "../querySpec.ts";
import { type SourceAdapter, type SearchOpts, getJson, yearOf } from "./adapter.ts";
import { biorxivPdfUrl } from "../oa/oa-url-normalize.ts";

const API = "https://api.biorxiv.org/details";

export function parseBiorxiv(json: any, server = "biorxiv"): SearchHit[] {
  const coll: any[] = json?.collection ?? [];
  // 同一 preprint 多版本，取最新版（按 version 数字最大）
  const byDoi = new Map<string, any>();
  for (const c of coll) {
    const prev = byDoi.get(c.doi);
    if (!prev || (+c.version || 0) >= (+prev.version || 0)) byDoi.set(c.doi, c);
  }
  return [...byDoi.values()].map((c) => {
    const publishedDoi = c.published && c.published !== "NA" ? String(c.published).toLowerCase() : undefined;
    return {
      source: server,
      doi: (c.doi ?? "").toLowerCase() || undefined,
      title: c.title,
      abstract: c.abstract,
      authors: c.authors ? String(c.authors).split(";").map((s: string) => s.trim()).filter(Boolean) : [],
      journal: server === "medrxiv" ? "medRxiv" : "bioRxiv",
      year: yearOf(c.date),
      pubDate: c.date,
      isPreprint: true,
      peerReviewed: false,
      oaUrl: c.doi ? biorxivPdfUrl(c.doi, c.version ?? 1, server) : undefined,
      relatedDoi: publishedDoi, // 版本归并：已发表 DOI
    } as SearchHit;
  }).filter((h) => h.title);
}

function matchesTerms(h: SearchHit, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${h.title} ${h.abstract ?? ""}`.toLowerCase();
  return terms.every((t) => hay.includes(t)); // AND 语义近似
}

function windowDates(since?: string): [string, string] {
  const to = new Date();
  const from = since ? new Date(since) : new Date(to.getTime() - 7 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return [fmt(from), fmt(to)];
}

function makeBiorxivAdapter(server: "biorxiv" | "medrxiv"): SourceAdapter {
  return {
    id: server,
    async search(q: QuerySpec, opts: SearchOpts = {}): Promise<SearchHit[]> {
      const [from, to] = windowDates(opts.since);
      const json = await getJson(`${API}/${server}/${from}/${to}/0`, opts);
      const terms = toTermList(q);
      return parseBiorxiv(json, server).filter((h) => matchesTerms(h, terms)).slice(0, opts.limit ?? 25);
    },
  };
}

export const biorxivAdapter = makeBiorxivAdapter("biorxiv");
export const medrxivAdapter = makeBiorxivAdapter("medrxiv");
