#!/usr/bin/env node
/** 定位类问答：全文检索锚点（如 200ms）应返回页码而非「无法确定」 */
import { extractSearchNeedles, findNeedlesInPages, tryLocateAnswer } from "../src/core/reader/reader-ai.ts";

const pages = [
  { page: 1, text: "Introduction to biological motion perception." },
  { page: 4, text: "Stimuli were presented for 200ms on each trial with ISI 500 ms." },
  { page: 5, text: "Participants responded within 2000 ms." },
];

const q = "具体哪里提到200ms";
const needles = extractSearchNeedles(q);
if (!needles.some((n) => n.includes("200"))) throw new Error("needles missing 200: " + JSON.stringify(needles));
const hits = findNeedlesInPages(pages, needles);
if (!hits.length || !hits.some((h) => h.page === 4)) throw new Error("expected page 4 hit: " + JSON.stringify(hits));
const ans = tryLocateAnswer(pages, q);
if (!ans || !/\[p\.4\]/.test(ans)) throw new Error("locate answer bad: " + ans);
if (/无法确定/.test(ans)) throw new Error("should not be uncertain");
console.log("smoke-reader-locate OK");
