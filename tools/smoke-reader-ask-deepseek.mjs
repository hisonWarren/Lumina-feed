#!/usr/bin/env node
/** DeepSeek 真机问答：定位类问题应返回页码（走全文检索短路，不依赖模型幻觉） */
import { askReader } from "../src/core/reader/reader-ai.ts";
import { llmFromConfig } from "../src/core/summarize/llm-client.ts";

const key = process.env.LUMINA_TEST_DEEPSEEK_KEY;
if (!key) {
  console.log("skip smoke-reader-ask-deepseek (no LUMINA_TEST_DEEPSEEK_KEY)");
  process.exit(0);
}

const pages = [
  { page: 1, text: "We studied biological motion perception in healthy adults." },
  { page: 4, text: "Each point-light walker was shown for 200ms followed by a 500ms mask." },
  { page: 7, text: "Reaction times were analyzed with mixed models." },
];

const llm = await llmFromConfig(
  { provider: "deepseek", model: "deepseek-chat" },
  () => key,
);

const q = "具体哪里提到200ms";
const r = await askReader(pages, q, llm);
console.log("answer:", r.text?.slice(0, 200));
if (!r.text || !/\[p\.4\]/.test(r.text)) throw new Error("expected [p.4] in answer");
if (/依据所给页面无法确定/.test(r.text)) throw new Error("should not be uncertain for locate hit");
console.log("smoke-reader-ask-deepseek OK grounded=" + r.groundedRatio);
