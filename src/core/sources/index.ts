// lumina-feed · 适配器注册表
import type { SourceAdapter } from "./adapter.ts";
import { pubmedAdapter } from "./pubmed.ts";
import { europepmcAdapter } from "./europepmc.ts";
import { crossrefAdapter } from "./crossref.ts";
import { openalexAdapter } from "./openalex.ts";
import { arxivAdapter } from "./arxiv.ts";
import { biorxivAdapter, medrxivAdapter } from "./biorxiv.ts";
import { semanticScholarAdapter } from "./semantic-scholar.ts";
import { doajAdapter } from "./doaj.ts";
import { dataciteAdapter } from "./datacite.ts";
import { coreAdapter } from "./core.ts";
import { lensAdapter } from "./lens.ts";
import { halAdapter } from "./hal.ts";
import { osfAdapter } from "./osf-preprints.ts";
import { zenodoAdapter } from "./zenodo.ts";
import { openaireAdapter } from "./openaire.ts";
import { dblpAdapter } from "./dblp.ts";
import { libgenAdapter } from "./libgen.ts";
import { annasAdapter } from "./annas.ts";
import { scihubAdapter } from "./scihub-stub.ts";
import { ADAPTER_META } from "./adapter-meta.ts";

export const ALL_ADAPTERS: SourceAdapter[] = [
  pubmedAdapter, europepmcAdapter, crossrefAdapter, openalexAdapter, arxivAdapter, biorxivAdapter, medrxivAdapter,
  semanticScholarAdapter, doajAdapter, dataciteAdapter,
  coreAdapter, lensAdapter, halAdapter, osfAdapter, zenodoAdapter, openaireAdapter, dblpAdapter,
  libgenAdapter, annasAdapter, scihubAdapter,
];

export function selectAdapters(
  sources?: string[],
  keys?: Record<string, string>,
  disabledSources?: string[],
): SourceAdapter[] {
  const disabled = new Set((disabledSources ?? []).map((s) => s.toLowerCase()));
  const set = sources?.length ? new Set(sources.map((s) => s.toLowerCase())) : null;
  let list = set ? ALL_ADAPTERS.filter((a) => set.has(a.id)) : ALL_ADAPTERS;
  list = list.filter((a) => !disabled.has(a.id));
  return list.filter((a) => {
    const meta = ADAPTER_META[a.id];
    if (!meta?.requiresKey) return true;
    if (meta.requiresKey === "core_key") return !!keys?.core;
    if (meta.requiresKey === "lens_token") return !!keys?.lens;
    return true;
  });
}

/** P8 · 设置面板用：20 源注册表元数据（顺序与 ALL_ADAPTERS 一致） */
export function listSourceRegistry() {
  return ALL_ADAPTERS.map((a) => ({ id: a.id, ...ADAPTER_META[a.id] }));
}

export { pubmedAdapter, europepmcAdapter, crossrefAdapter, openalexAdapter, arxivAdapter, biorxivAdapter, medrxivAdapter };
export { ADAPTER_META };
