/** 通路探针：DOI 格式 + 匹配标签（写 debug-07b43d.log） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIdentifier, classifyInput } from "../src/core/locate/parse-identifier.ts";
import { bm25Rank, parseQuery } from "../src/core/rank/bm25.ts";
import { pickPrimaryHit } from "../src/core/locate/primary-hit.ts";
import { refreshCardMatchKinds } from "../src/ui/lib/refresh-match-kind.js";

const LOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "debug-07b43d.log");
const sessionId = "07b43d";

function log(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  const line = JSON.stringify({
    sessionId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
    runId: "probe-pathways",
  });
  fs.appendFileSync(LOG, line + "\n");
}

const doiCases = [
  "10.1038/nature12373",
  "doi:10.1038/nature12373",
  "DOI:10.1038/nature12373",
  "https://doi.org/10.1038/nature12373",
  "http://dx.doi.org/10.1038/nature12373",
  "https://doi.org/10.48550/arXiv.1706.03762",
  "10.48550/arXiv.1706.03762",
  "pmid:12345678",
  "https://pubmed.ncbi.nlm.nih.gov/12345678/",
  "2301.00001",
  "arxiv:2301.00001",
  "https://arxiv.org/abs/2301.00001",
  "PMC1234567",
  "covid vaccine efficacy",
];

for (const raw of doiCases) {
  const kind = classifyInput(raw);
  const parsed = parseIdentifier(raw);
  log("H6-H8", "probe-pathways.ts:doi", "parseIdentifier", {
    raw,
    kind,
    parsed: parsed ? { kind: parsed.kind, normalized: parsed.normalized } : null,
  });
}

const pq = parseQuery("covid vaccine efficacy", "all");
const ranked = bm25Rank(
  [{ id: "pfizer", title: "Pfizer COVID vaccine efficacy in children aged 5-11 years." }],
  pq,
)[0];
const primary = pickPrimaryHit([{ id: "pfizer", title: ranked.item.title as string }], "covid vaccine efficacy");
log("H1-H4", "probe-pathways.ts:bm25", "covid match", {
  matchKind: ranked.matchKind,
  primary: primary ? { matchKind: primary.matchKind, ambiguous: primary.ambiguous } : null,
});

const staleCards = [
  { id: "pfizer", title: "Pfizer COVID vaccine efficacy in children aged 5-11 years.", matchKind: "title_exact" },
];
const refreshed = refreshCardMatchKinds(staleCards, "covid vaccine efficacy", "all");
log("H2", "probe-pathways.ts:refresh", "session refresh", {
  before: staleCards[0].matchKind,
  after: refreshed[0].matchKind,
});

console.log("probe-pathways done → debug-07b43d.log");
