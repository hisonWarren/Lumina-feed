#!/usr/bin/env node
/** 探测单篇 DOI 的元数据 + 直链 + LibGen 可达性 */
import { isLegitimateOaUrl, isFetchableUrl } from "../src/core/summarize/oa-guard.ts";

const doi = process.argv[2] || "10.1068/i198";
const email = process.argv[3] || "wxs_insist@163.com";
const sagePdf = `https://journals.sagepub.com/doi/pdf/${doi}`;

console.log("\n=== oa-guard ===");
console.log("Sage legitimate?", isLegitimateOaUrl(sagePdf));
console.log("Sage fetchable (OA-only)?", isFetchableUrl(sagePdf, { allowAltSources: false }));

console.log("\n=== Unpaywall ===");
const up = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`);
console.log("status", up.status);
if (up.ok) {
  const j = await up.json();
  console.log("best pdf", j.best_oa_location?.url_for_pdf);
}

console.log("\n=== Sage direct ===");
const t0 = Date.now();
const sage = await fetch(sagePdf, { redirect: "follow", headers: { accept: "application/pdf,*/*", "user-agent": "Mozilla/5.0" } });
const sageBuf = Buffer.from(await sage.arrayBuffer());
console.log("status", sage.status, "ms", Date.now() - t0, "bytes", sageBuf.length, "magic", sageBuf.slice(0, 8).toString());

console.log("\n=== LibGen ===");
for (const mirror of ["https://libgen.la", "https://libgen.li"]) {
  try {
    const u = `${mirror}/index.php?req=${encodeURIComponent(doi)}&column=doi`;
    const t1 = Date.now();
    const r = await fetch(u, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
    const text = await r.text();
    const md5 = text.match(/md5=([a-f0-9]{32})/i)?.[1];
    console.log(mirror, "search", r.status, Date.now() - t1 + "ms", "md5", md5 || "none");
    if (!md5) continue;
    const r2 = await fetch(`${mirror}/ads.php?md5=${md5}`, { redirect: "follow" });
    const t2 = await r2.text();
    const get = t2.match(/get\.php\?[^"']+/i)?.[0];
    if (!get) { console.log("  no get.php"); continue; }
    const pdfUrl = `${mirror}/${get}`;
    const t3 = Date.now();
    const r3 = await fetch(pdfUrl, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
    const buf = Buffer.from(await r3.arrayBuffer());
    console.log("  pdf", r3.status, Date.now() - t3 + "ms", "bytes", buf.length, "magic", buf.slice(0, 4).toString());
  } catch (e) {
    console.log(mirror, "err", e.message);
  }
}
