// src/core/sources/adapter-meta.ts
// Registry metadata for the expanded source set.
// requiresKey/optionalKey name a KEYCHAIN secret (NOT an AppSettings field) — red-line 3 (review F1).
export type KeyName = "core_key" | "lens_token" | "semanticscholar_key" | "ncbi_key";
export interface AdapterMeta {
  label: string;
  requiresKey?: KeyName;     // source skipped (graceful) without it
  optionalKey?: KeyName;     // works without; better with
  slow?: boolean;            // 15s timeout vs 8s default
  defaultEnabled: boolean;
  attribution?: string;      // ToS attribution requirement, if any
  getKeyUrl?: string;        // where the user obtains a key
}
export const ADAPTER_META: Record<string, AdapterMeta> = {
  pubmed:          { label: "PubMed", optionalKey: "ncbi_key", defaultEnabled: true, getKeyUrl: "https://www.ncbi.nlm.nih.gov/account/settings/" },
  europepmc:       { label: "Europe PMC", defaultEnabled: true },
  crossref:        { label: "Crossref", defaultEnabled: true },
  openalex:        { label: "OpenAlex", defaultEnabled: true, attribution: "CC0" },
  arxiv:           { label: "arXiv", defaultEnabled: true },
  biorxiv:         { label: "bioRxiv", defaultEnabled: true },
  medrxiv:         { label: "medRxiv", defaultEnabled: true },
  semanticscholar: { label: "Semantic Scholar", optionalKey: "semanticscholar_key", slow: true, defaultEnabled: true,
                     attribution: "Attribution required (S2 API ToS)", getKeyUrl: "https://www.semanticscholar.org/product/api" },
  doaj:            { label: "DOAJ", defaultEnabled: true },
  datacite:        { label: "DataCite", defaultEnabled: true },
  core:            { label: "CORE", requiresKey: "core_key", slow: true, defaultEnabled: false, getKeyUrl: "https://core.ac.uk/services/api" },
  lens:            { label: "Lens.org", requiresKey: "lens_token", slow: true, defaultEnabled: false, getKeyUrl: "https://www.lens.org/lens/user/subscriptions" },
  hal:             { label: "HAL", defaultEnabled: true },
  osf:             { label: "OSF Preprints", defaultEnabled: true },
  zenodo:          { label: "Zenodo", slow: true, defaultEnabled: true },
  openaire:        { label: "OpenAIRE", slow: true, defaultEnabled: true },
  dblp:            { label: "DBLP", defaultEnabled: true },
  libgen:          { label: "LibGen", slow: true, defaultEnabled: true },
  annas:           { label: "Anna's Archive", slow: true, defaultEnabled: true },
  scihub:          { label: "Sci-Hub", defaultEnabled: true },
};
const SCRAPE_TIMEOUT_MS = 22000;
export function timeoutFor(source: string): number {
  if (source === "libgen" || source === "annas") return SCRAPE_TIMEOUT_MS;
  return ADAPTER_META[source]?.slow ? 15000 : 8000;
}
export function keyNameFor(source: string): KeyName | undefined { const m = ADAPTER_META[source]; return m?.requiresKey ?? m?.optionalKey; }
