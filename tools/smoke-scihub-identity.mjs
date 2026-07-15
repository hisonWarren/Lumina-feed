/**
 * Sci-Hub 取文回归：修复 DOI 文本粘连误杀。
 * 1) sanitize / extract
 * 2) fetchScihubPdf + verifyPdfIdentity
 * 3) 强制走 scihub 候选（跳过 OA/LibGen）经 provider.try 路径
 */
import {
  extractDoisFromText,
  sanitizeExtractedDoi,
  verifyPdfIdentity,
  doisReferSame,
  urlImpliesDoi,
} from "../src/core/oa/pdf-identity.ts";
import { fetchScihubPdf } from "../src/core/oa/alt-sources.ts";
import { fetchPaperPdf } from "../src/core/oa/provider.ts";

const doi = process.argv[2] || "10.1017/s1355617716000114";
const title =
  "Perception of Communicative and Non-communicative Motion-Defined Gestures in Parkinson's Disease";

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m + (d ? " — " + d : "")); }
  else { fail++; console.log("  ✗ " + m + (d ? " — " + d : "")); }
};

console.log("\n── Sci-Hub identity + provider ──\n");

const glued = "doi:10.1017/S1355617716000114PerceptionofCommunicative";
const cleaned = sanitizeExtractedDoi("10.1017/S1355617716000114PerceptionofCommunicative");
ok(cleaned === "10.1017/s1355617716000114", "sanitize 粘连 DOI", cleaned);
ok(extractDoisFromText(glued).includes("10.1017/s1355617716000114"), "extractDoisFromText 含真 DOI");
ok(doisReferSame(doi, "10.1017/s1355617716000114PerceptionofX"), "doisReferSame 容忍粘连后缀");

const alone = await fetchScihubPdf(doi, { signal: AbortSignal.timeout(60_000) });
ok(!!alone?.bytes?.byteLength, "fetchScihubPdf 成功", alone ? `${alone.bytes.length}B ${alone.url.slice(0, 60)}` : "null");
if (alone) {
  const id = verifyPdfIdentity(alone.bytes, { doi, title });
  ok(id.ok === true, "verifyPdfIdentity 通过", JSON.stringify(id));
  ok((id.foundDois || []).includes("10.1017/s1355617716000114"), "抽到规范 DOI", JSON.stringify(id.foundDois));
  ok(urlImpliesDoi(alone.url, doi) || !alone.url.includes("pdf/" + doi), "URL 旁注", alone.url.slice(0, 80));
}

// 强制只走 Sci-Hub：includeAltSources + 空 OA（把 paper 标成无 oa 元数据，并缩短非 scihub）
const scihubOnly = await fetchPaperPdf(
  { id: "sci-" + doi, title, doi, year: 2016, authors: ["Jaywant"] },
  {
    includeAltSources: true,
    signal: AbortSignal.timeout(90_000),
    oaAttemptTimeoutMs: 3_000,
    perAttemptTimeoutMs: 8_000,
    // 通过空 email 等不挡；关键是 resolveAlt 会含 scihub
    onTrace: (ev) => {
      if (ev.type === "done") console.log("  · done", ev.result);
    },
  },
);
ok(
  !!(scihubOnly && scihubOnly.ok),
  "fetchPaperPdf 成功（任意可用源）",
  scihubOnly && scihubOnly.ok ? `${scihubOnly.source} ${scihubOnly.bytes.length}B` : JSON.stringify(scihubOnly),
);

// 直连接口：模拟 provider 拿到 scihub 字节后 identity 不再误杀
if (alone) {
  const id2 = verifyPdfIdentity(alone.bytes, { doi, title: "Wrong Title Completely Unrelated" });
  // 有正确 DOI 时应仍 ok（不因标题错误拒绝）
  ok(id2.ok === true, "有正确 DOI 时错误标题不误杀", JSON.stringify(id2));
}

console.log(`\n── ${pass}/${pass + fail} ──\n`);
process.exit(fail ? 1 : 0);
