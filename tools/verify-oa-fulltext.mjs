// lumina-feed · M3 合法 OA 取全文 行为门（沙箱真跑：含 zlib 真实 PDF 抽取往返）
// 运行：node --experimental-strip-types tools/verify-oa-fulltext.mjs
import * as zlib from "node:zlib";
import { resolveOa, resolvePdfCandidates } from "../src/core/oa/oa-resolver.ts";
import { fetchPdf } from "../src/core/oa/pdf-fetch.ts";
import { extractPdfTextBasic, extractWithPdfjs, extractText } from "../src/core/oa/pdf-extract.ts";
import { makeOaFullTextProvider } from "../src/core/oa/provider.ts";
import { isLegitimateOaUrl } from "../src/core/oa/index.ts";
import { makeFullTextProvider } from "../src/core/summarize/fulltext.ts";
import { summarizePaper } from "../src/core/summarize/summarizer.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };

const paper = (over = {}) => ({
  id: "doi:10.1/x", doi: "10.1/abc", title: "SGLT2 inhibitors in heart failure",
  abstract: "A randomized trial.", authors: ["Lee J"], journal: "NEJM", year: 2026,
  studyTypes: ["rct"], source: "pubmed", isPreprint: false, peerReviewed: true, retracted: false,
  versions: [], ingestedAt: "2026-06-26", ...over,
});

// ── 自造最小 PDF（FlateDecode 文本流），用于真实抽取往返 ──
function makePdf(text, compress = true) {
  const esc = text.replace(/([()\\])/g, "\\$1");
  const content = `BT /F1 24 Tf 72 700 Td (${esc}) Tj ET`;
  const data = compress ? zlib.deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
  const filter = compress ? "/Filter /FlateDecode " : "";
  const objs =
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n` +
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  const streamObj = Buffer.concat([
    Buffer.from(`4 0 obj\n<< /Length ${data.length} ${filter}>>\nstream\n`, "latin1"),
    data, Buffer.from(`\nendstream\nendobj\n`, "latin1"),
  ]);
  return new Uint8Array(Buffer.concat([
    Buffer.from("%PDF-1.4\n", "latin1"), Buffer.from(objs, "latin1"), streamObj,
    Buffer.from(`trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n`, "latin1"),
  ]));
}
function pdfResponse(bytes) {
  return { ok: true, headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/pdf" : k.toLowerCase() === "content-length" ? String(bytes.byteLength) : null) }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

// ───────── A. OA 解析（多源 + 守门 + 排序） ─────────
console.log("— A. OA 解析（Unpaywall/OpenAlex/EuropePMC + 守门 + 排序） —");
{
  const fake = async (url) => {
    const u = String(url); const J = (o) => ({ ok: true, json: async () => o });
    if (u.includes("api.unpaywall.org")) return J({ best_oa_location: { url_for_pdf: "https://europepmc.org/articles/PMC9/pdf" }, oa_locations: [{ url: "https://sci-hub.se/10.1/abc" }] });
    if (u.includes("api.openalex.org")) return J({ best_oa_location: { pdf_url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9/pdf/main.pdf" }, locations: [] });
    if (u.includes("europepmc.org") || u.includes("ebi.ac.uk")) return J({ resultList: { result: [{ fullTextUrlList: { fullTextUrl: [{ availabilityCode: "OA", url: "https://europepmc.org/article/MED/9" }] } }] } });
    return { ok: false };
  };
  const urls = await resolveOa(paper(), { email: "you@example.com", fetchImpl: fake, includeAltSources: false });
  ok(urls.length >= 2, `解析出多个候选(实得 ${urls.length})`);
  ok(!urls.some((u) => /sci-hub/i.test(u)), "strict 模式: Sci-Hub 被 isLegitimateOaUrl 剔除");
  ok(urls[0].includes("europepmc.org/articles/PMC9/pdf"), "排序:按 priority 高优先级在前");

  const all = await resolvePdfCandidates(paper(), { email: "you@example.com", fetchImpl: fake, use: { altSources: false, scihub: false } });
  ok(all.every((c) => c.kind === "url"), "统一链可关闭备选渠道");

  // identifiers 直接构造（无网络）
  const u2 = await resolveOa(paper({ doi: undefined, pmcid: "PMC123", arxivId: "2606.01" }), {});
  ok(u2.some((u) => u.includes("PMC123")) && u2.some((u) => u.includes("arxiv.org/pdf/2606.01")), "从 pmcid/arxivId 构造 OA 链接");
}

// ───────── B. PDF 抓取（守门 + 类型 + 大小 + 桥） ─────────
console.log("— B. PDF 抓取（守门/类型/大小/Electron 桥） —");
{
  const pdf = makePdf("hello");
  // web fetch 路径
  const bytes = await fetchPdf("https://europepmc.org/x.pdf", { fetchImpl: async () => pdfResponse(pdf) });
  ok(bytes.byteLength === pdf.byteLength, "web fetch 取到 PDF 字节");
  // 守门拒影子库
  let denied = false;
  try { await fetchPdf("https://sci-hub.se/10.1/abc", { fetchImpl: async () => pdfResponse(pdf), allowAltSources: false }); } catch { denied = true; }
  ok(denied, "strict 模式:拒绝抓取 Sci-Hub");
  let altOk = false;
  try {
    const b = await fetchPdf("https://sci-hub.se/10.1/abc", { fetchImpl: async () => pdfResponse(pdf), allowAltSources: true });
    altOk = b.byteLength === pdf.byteLength;
  } catch { altOk = false; }
  ok(altOk, "统一链模式:备选 URL 可抓取");
  // content-type 非 PDF 拒绝
  let ctRej = false;
  try { await fetchPdf("https://europepmc.org/x.pdf", { fetchImpl: async () => ({ ok: true, headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(8) }) }); } catch { ctRej = true; }
  ok(ctRej, "content-type 非 PDF→拒绝");
  // Electron 桥路径
  const viaBridge = await fetchPdf("https://europepmc.org/x.pdf", { electronFetch: async () => pdf });
  ok(viaBridge.byteLength === pdf.byteLength, "Electron 桥取字节(magic 校验通过)");
  // 大小上限
  let tooBig = false;
  try { await fetchPdf("https://europepmc.org/x.pdf", { electronFetch: async () => pdf, maxBytes: 4 }); } catch { tooBig = true; }
  ok(tooBig, "超过大小上限→拒绝");
  // 非 PDF magic 拒绝
  let magicRej = false;
  try { await fetchPdf("https://europepmc.org/x.pdf", { electronFetch: async () => new Uint8Array([1, 2, 3, 4]) }); } catch { magicRej = true; }
  ok(magicRej, "非 PDF magic→拒绝");
}

// ───────── C. PDF 文本抽取（真实 zlib 往返） ─────────
console.log("— C. PDF 文本抽取（内置 zlib，真 PDF 往返） —");
{
  const marker = "Lumina fulltext marker 12345";
  const pdf = makePdf(marker, true);
  const text = extractPdfTextBasic(pdf);
  ok(text.includes(marker), `FlateDecode 流抽取回原文（含 marker）`);

  const pdf2 = makePdf("uncompressed body XYZ", false);
  ok(extractPdfTextBasic(pdf2).includes("uncompressed body XYZ"), "未压缩文本流抽取");

  // TJ 数组
  const tjContent = `BT /F1 12 Tf 72 700 Td [(Hel) -250 (lo) -250 (World)] TJ ET`;
  const dataTj = zlib.deflateSync(Buffer.from(tjContent, "latin1"));
  const pdfTj = new Uint8Array(Buffer.concat([
    Buffer.from("%PDF-1.4\n4 0 obj\n<< /Length " + dataTj.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
    dataTj, Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
  ]));
  ok(extractPdfTextBasic(pdfTj).replace(/\s/g, "").includes("HelloWorld"), "TJ 数组拼接抽取");

  // pdfjs 包装（注入假 loader）
  const fakeLoad = async () => ({ numPages: 2, getPage: async (n) => ({ getTextContent: async () => ({ items: [{ str: `page${n}` }, { str: "text" }] }) }) });
  const viaPdfjs = await extractWithPdfjs(pdf, fakeLoad);
  ok(viaPdfjs.includes("page1") && viaPdfjs.includes("page2"), "pdfjs 包装:多页拼接");

  // extractText 选择 pdfjs（文本足够长时）
  const longLoad = async () => ({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "x".repeat(300) }] }) }) });
  ok((await extractText(pdf, { pdfjsLoad: longLoad })).length >= 300, "extractText 优先 pdfjs(文本足够)");
}

// ───────── D. provider 端到端 + E. 接 M4 全文级总结 ─────────
console.log("— D/E. 全文提供者端到端 + 接 M4 总结 —");
{
  const marker = "DETAILED METHODS: double-blind RCT of 1200 patients, HR 0.75.";
  const pdf = makePdf(marker, true);
  // 路由 fetch：解析(unpaywall→PMC pdf) + 抓取(返回该 PDF)
  const fake = async (url) => {
    const u = String(url);
    if (u.includes("api.unpaywall.org")) return { ok: true, json: async () => ({ best_oa_location: { url_for_pdf: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9/pdf/main.pdf" }, oa_locations: [] }) };
    if (u.includes("api.openalex.org")) return { ok: true, json: async () => ({ best_oa_location: null, locations: [] }) };
    if (u.includes("ebi.ac.uk")) return { ok: true, json: async () => ({ resultList: { result: [] } }) };
    if (u.includes("ncbi.nlm.nih.gov")) return pdfResponse(pdf); // 抓 PDF
    return { ok: false };
  };
  const provider = makeOaFullTextProvider({ email: "you@example.com", fetchImpl: fake, minChars: 30 });
  const got = await provider.getFullText(paper());
  ok(got && got.text.includes("DETAILED METHODS") && /ncbi/.test(got.url), "provider:解析→抓取→抽取 拿到全文");

  // 影子库 only → 守门 → null（回退摘要）
  const fakeShadow = async (url) => String(url).includes("api.unpaywall.org")
    ? { ok: true, json: async () => ({ best_oa_location: { url_for_pdf: "https://sci-hub.se/10.1/abc" }, oa_locations: [] }) }
    : { ok: false };
  const got2 = await makeOaFullTextProvider({ email: "x@y.com", fetchImpl: fakeShadow, includeAltSources: false }).getFullText(paper());
  ok(got2 === null, "strict 模式:仅影子库候选→null(将回退摘要)");

  // 超时跳过 → 末尾集中重试
  let calls = [];
  let slowCalls = 0;
  const slow = makeFullTextProvider({
    resolveCandidates: () => [
      { kind: "url", url: "https://slow.example/a.pdf", source: "slow", priority: 1 },
      { kind: "url", url: "https://bad.example/b.pdf", source: "bad", priority: 2 },
    ],
    perAttemptTimeoutMs: 40,
    fetchPdf: async (url, signal) => {
      calls.push(url);
      if (url.includes("slow")) {
        slowCalls++;
        if (slowCalls === 1) {
          await new Promise((_, reject) => {
            const t = setTimeout(() => reject(new Error("still slow")), 200);
            const onAbort = () => { clearTimeout(t); reject(new Error("AbortError")); };
            if (signal?.aborted) onAbort();
            else signal?.addEventListener("abort", onAbort, { once: true });
          });
        }
        return pdf;
      }
      throw new Error("hard fail");
    },
    extractText: async () => marker,
    minChars: 10,
  });
  const gotRetry = await slow.getFullText(paper());
  ok(gotRetry && gotRetry.url.includes("slow"), "超时先跳过，末尾重试 slow 成功");
  ok(slowCalls === 2, "slow 被尝试两次(首轮超时+末尾重试)");
  ok(calls.indexOf("https://bad.example/b.pdf") < calls.lastIndexOf("https://slow.example/a.pdf"), "bad 在 slow 重试之前已试");

  // 接 M4：prefer_fulltext → 基于全文，且 LLM 收到抽取的全文
  let seenUserText = "";
  const fakeLlm = { id: "fake", model: "t", async complete(msgs) { seenUserText = msgs.find((m) => m.role === "user")?.content ?? ""; return "全文级总结。"; } };
  const res = await summarizePaper(paper(), { source: "prefer_fulltext", fetchPdf: "if_oa", depth: "tldr", language: "zh", scope: "digest_hits" }, { llm: fakeLlm, fullText: provider });
  ok(res.sourceBasis === "fulltext", "接 M4：prefer_fulltext + 取到全文 → 基于全文");
  ok(seenUserText.includes("DETAILED METHODS"), "LLM 实际收到的是抽取出的全文");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
