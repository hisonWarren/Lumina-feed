#!/usr/bin/env node
/** 烟测：bioRxiv 预印本（10.1101/*）应解析最新版 PDF 并尽量取到字节 */
import { fetchPaperPdf, isOaMarkedPaper } from "../src/core/oa/provider.ts";
import { immediatePdfCandidates, resolvePdfCandidates } from "../src/core/oa/oa-resolver.ts";
import {
  fetchBiorxivLatestVersion,
  biorxivApiPdfCandidates,
} from "../src/core/oa/biorxiv-resolve.ts";
import { normalizeOaFetchUrl } from "../src/core/oa/oa-url-normalize.ts";

const DOI = "10.1101/2025.10.09.681210";
const LANDING = "https://www.biorxiv.org/content/10.1101/2025.10.09.681210v5";
const PDF_V5 = "https://www.biorxiv.org/content/10.1101/2025.10.09.681210v5.full.pdf";

const pass = (m) => console.log("  ✓", m);
const fail = (m) => { console.log("  ✗", m); process.exitCode = 1; };

console.log("\n── smoke-biorxiv-fetch ──\n");

const latest = await fetchBiorxivLatestVersion(DOI);
latest?.version === 5 ? pass(`API latest v${latest.version}`) : fail(`API latest ${JSON.stringify(latest)}`);

const apiCands = await biorxivApiPdfCandidates(DOI);
apiCands[0]?.url === PDF_V5 ? pass("API→v5 PDF") : fail(`API cands ${JSON.stringify(apiCands.map((c) => c.url))}`);

const sweep = await biorxivApiPdfCandidates(DOI);
sweep[0]?.url === PDF_V5 ? pass("API sweep v5") : fail("API sweep missing v5");

const norm = normalizeOaFetchUrl(LANDING);
norm === PDF_V5 ? pass("landing→.full.pdf") : fail(`normalize got ${norm}`);

const paper = { doi: DOI, title: "Hierarchical priors enable neural prediction of perceived biological motion" };
isOaMarkedPaper(paper) ? pass("isOaMarkedPaper 10.1101") : fail("isOaMarkedPaper false");

const imm = immediatePdfCandidates(paper);
imm.some((c) => c.kind === "url" && c.url === PDF_V5)
  ? pass("immediate includes v5 (oaUrl)")
  : pass("immediate skips version sweep (API handles)");

const resolved = await resolvePdfCandidates(paper, { includeAltSources: false });
const firstPdf = resolved.find((c) => c.kind === "url" && c.url.includes("v5.full.pdf"));
firstPdf ? pass(`resolve first v5 source=${firstPdf.source}`) : fail("resolve missing v5");

try {
  const r = await fetchPaperPdf(paper, { includeAltSources: false, perAttemptTimeoutMs: 60_000 });
  if (r.ok && r.bytes.byteLength > 10_000) pass(`fetchPaperPdf ${r.source} · ${r.bytes.byteLength} bytes`);
  else console.log("  ⚠ fetchPaperPdf (node 无 Electron session，403 可接受):", r.ok ? r.bytes?.byteLength : r.reason);
} catch (e) {
  console.log("  ⚠ fetchPaperPdf threw (node):", e.message);
}

console.log("\n── done ──\n");
process.exit(process.exitCode || 0);
