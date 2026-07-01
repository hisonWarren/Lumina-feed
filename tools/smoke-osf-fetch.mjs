#!/usr/bin/env node
/** 烟测：OSF PsyArXiv 预印本（10.31234/osf.io/*）应能经 download 直链取到 PDF */
import { fetchPaperPdf } from "../src/core/oa/provider.ts";
import { parseOsf, osfDoiDownloadUrl, normalizeOsfFetchUrl } from "../src/core/sources/osf-preprints.ts";

const DOI = "10.31234/osf.io/jfrwu_v1";
const pass = (m) => console.log("  ✓", m);
const fail = (m) => { console.log("  ✗", m); process.exitCode = 1; };

console.log("\n── smoke-osf-fetch ──\n");

const dl = osfDoiDownloadUrl(DOI);
dl === "https://osf.io/jfrwu/download" ? pass("DOI→download") : fail(`DOI→download got ${dl}`);

const norm = normalizeOsfFetchUrl("https://osf.io/preprints/psyarxiv/jfrwu_v1/");
norm === "https://osf.io/jfrwu/download" ? pass("HTML→download") : fail(`normalize got ${norm}`);

const hit = parseOsf({
  data: [{ id: "jfrwu_v1", attributes: { title: "T" }, links: { html: "https://osf.io/preprints/psyarxiv/jfrwu_v1/" } }],
})[0];
hit?.oaUrl === "https://osf.io/jfrwu/download" ? pass("parseOsf oaUrl") : fail(`parseOsf oaUrl=${hit?.oaUrl}`);

const paper = {
  doi: DOI,
  title: "False Memories From Biological Motion Observation",
  oaUrl: "https://osf.io/preprints/psyarxiv/jfrwu_v1/",
  oaStatus: "gold",
};
try {
  const r = await fetchPaperPdf(paper, { includeAltSources: false, perAttemptTimeoutMs: 45_000 });
  if (r.ok && r.bytes.byteLength > 10_000) pass(`fetchPaperPdf ${r.source} · ${r.bytes.byteLength} bytes`);
  else fail(`fetchPaperPdf ${JSON.stringify(r)}`);
} catch (e) {
  fail(`fetchPaperPdf threw ${e.message}`);
}

console.log("\n── done ──\n");
process.exit(process.exitCode || 0);
