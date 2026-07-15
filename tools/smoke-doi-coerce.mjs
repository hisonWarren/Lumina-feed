import assert from "node:assert/strict";
import { classifyInput, coerceDoiCandidate, parseIdentifier } from "../src/core/locate/parse-identifier.ts";

const spaced = "10.1017/S1355 617716000114";
assert.equal(coerceDoiCandidate(spaced), "10.1017/s1355617716000114");
assert.equal(classifyInput(spaced), "doi");
assert.equal(parseIdentifier(spaced)?.normalized, "10.1017/s1355617716000114");

const under = "10.1016_S1355-0306(22)00006-5";
assert.equal(classifyInput(under), "doi");

assert.equal(classifyInput("not a doi at all"), "text");
console.log("smoke-doi-coerce: ok");
