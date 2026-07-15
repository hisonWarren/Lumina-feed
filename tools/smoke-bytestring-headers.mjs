// Smoke: ByteString header sanitize (U+2019 must not remain in header values).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(join(root, "src/core/net/byte-string.ts")).href);
const { toByteStringHeader, sanitizeHeadersInit, safeHeaderEmail, isByteStringError, firstNonLatin1 } = mod;

const curly = "author\u2019s paper title here";
assert.equal(firstNonLatin1(curly)?.code, 8217);
assert.ok(!firstNonLatin1(toByteStringHeader(curly)));
assert.equal(safeHeaderEmail("o\u2019brien@example.com"), "unknown");
assert.equal(safeHeaderEmail("you@example.org"), "you@example.org");

const h = sanitizeHeadersInit({
  Authorization: `Bearer sk-test${"x".repeat(160)}\u2019`,
  Accept: "application/json",
});
assert.ok(!firstNonLatin1(h.Authorization));
assert.equal(h.Accept, "application/json");

assert.ok(isByteStringError(new TypeError(
  "Cannot convert argument to a ByteString because the character at index 193 has a value of 8217 which is greater than 255.",
)));

console.log("smoke-bytestring-headers: ok");
