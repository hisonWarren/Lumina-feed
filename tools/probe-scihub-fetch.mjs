import { fetchScihubPdf } from "../src/core/oa/alt-sources.ts";

const doi = process.argv[2] || "10.1017/s1355617716000114";
const r = await fetchScihubPdf(doi);
if (!r) {
  console.log({ ok: false, doi });
  process.exit(1);
}
console.log({
  ok: true,
  doi,
  bytes: r.bytes.length,
  url: r.url.slice(0, 160),
  magic: String.fromCharCode(...r.bytes.slice(0, 4)),
});
