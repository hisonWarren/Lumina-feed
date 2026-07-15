/** Structure + HTML extract smoke for Sci-Hub object/iframe parsers. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(join(root, "src/core/oa/alt-sources.ts")).href);
const { extractPdfUrlFromHtml } = mod;

const page = "https://sci-hub.jp/10.1017/s1355617716000114";
const objectHtml = `
<html><head><title>Sci-Hub. Perception of Communicative...</title></head>
<body>
<object data = "/storage/zero/5214/bb7d1a50c08d04cf06c66456d93de73b/jaywant2016.pdf#navpanes=0&view=FitH" type="application/pdf"></object>
</body></html>`;
const iframeHtml = `<iframe id = "pdf" src = "//moscow.sci-hub.st/1234/abcd.pdf#navpanes=0"></iframe>`;
const captchaHtml = `<html><head><title translate = "en:title">Sci-Hub: are you are robot?</title></head><body><script src="/scripts/altcha.min.js"></script></body></html>`;

const u1 = extractPdfUrlFromHtml(objectHtml, page);
assert.equal(
  u1,
  "https://sci-hub.jp/storage/zero/5214/bb7d1a50c08d04cf06c66456d93de73b/jaywant2016.pdf",
);
const u2 = extractPdfUrlFromHtml(iframeHtml, page);
assert.equal(u2, "https://moscow.sci-hub.st/1234/abcd.pdf");
assert.equal(extractPdfUrlFromHtml(captchaHtml, page), null);

console.log("smoke-scihub-extract: ok");
