// lumina-feed · 适配器注册表
import type { SourceAdapter } from "./adapter.ts";
import { pubmedAdapter } from "./pubmed.ts";
import { europepmcAdapter } from "./europepmc.ts";
import { crossrefAdapter } from "./crossref.ts";
import { openalexAdapter } from "./openalex.ts";
import { arxivAdapter } from "./arxiv.ts";
import { biorxivAdapter, medrxivAdapter } from "./biorxiv.ts";

export const ALL_ADAPTERS: SourceAdapter[] = [
  pubmedAdapter, europepmcAdapter, crossrefAdapter, openalexAdapter, arxivAdapter, biorxivAdapter, medrxivAdapter,
];

export function selectAdapters(sources?: string[]): SourceAdapter[] {
  if (!sources?.length) return ALL_ADAPTERS;
  const set = new Set(sources.map((s) => s.toLowerCase()));
  return ALL_ADAPTERS.filter((a) => set.has(a.id));
}

export { pubmedAdapter, europepmcAdapter, crossrefAdapter, openalexAdapter, arxivAdapter, biorxivAdapter, medrxivAdapter };
