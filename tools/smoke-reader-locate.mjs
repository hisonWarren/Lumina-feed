#!/usr/bin/env node
/** 定位类问答：全文检索锚点（如 200ms）应返回页码而非「无法确定」 */
import { extractLocateQuery, extractSearchNeedles, findNeedlesInPages, tryLocateAnswer } from "../src/core/reader/reader-ai.ts";

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

const longQ = "静止时是一团散点，一旦运动立即被看成「人」；约 200 ms 内即可读出动作、方向乃至情绪——生物运动是高效的社会知觉载体。。200ms具体是在哪提到";
const lq = extractLocateQuery(longQ);
if (!/(200|提到|在哪)/i.test(lq)) throw new Error("extractLocateQuery failed: " + lq);
const longAns = tryLocateAnswer(pages, longQ);
if (!longAns || !/\[p\.4\]/.test(longAns)) throw new Error("long locate answer bad: " + longAns);

console.log("smoke-reader-locate OK");
