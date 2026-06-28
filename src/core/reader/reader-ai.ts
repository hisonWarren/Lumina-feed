// lumina-feed · 阅读器接地 AI —— patch: reader_engine
// 对"当前打开 PDF 的逐页文本"做接地总结 / 问答，附可点击页码引用 [p.X]。
// 复用 LlmClient.complete + 阅读器专用页锚接地（groundReaderAnswer，按 claim 在引用页切片内核验）。红线：只单篇、必带 sourceBasis、带页码引用、不杜撰。
import type { LlmClient } from "../summarize/types.ts";

export interface ReaderPage { page: number; text: string }
export interface ReaderCitation { page: number }
export interface ReaderAnswer {
  text: string;
  sourceBasis: "fulltext"; // 阅读器文本来自用户已打开的真实 PDF
  model: string;
  groundedRatio: number;
  banner?: string;
  citations: ReaderCitation[];
}

const CTX_CHARS = 12000;

function norm(s: string): string { return (s || "").replace(/\s+/g, " ").trim(); }

function tokens(s: string): string[] {
  return norm(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
}

/** 页锚 RAG：按与问题的词重叠给页面打分，取前 k 页（页数不多则全取）。 */
export function selectPages(pages: ReaderPage[], query: string, k = 6): ReaderPage[] {
  if (pages.length <= k) return pages;
  const q = new Set(tokens(query));
  if (q.size === 0) return pages.slice(0, k);
  const scored = pages.map((p) => {
    let hit = 0;
    for (const t of tokens(p.text)) if (q.has(t)) hit += 1;
    return { p, score: hit };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k).filter((x) => x.score > 0).map((x) => x.p);
  const chosen = top.length ? top : pages.slice(0, k);
  return chosen.slice().sort((a, b) => a.page - b.page);
}

function buildContext(pages: ReaderPage[], cap = CTX_CHARS): string {
  let out = "";
  for (const p of pages) {
    const chunk = "[p." + p.page + "]\n" + norm(p.text) + "\n\n";
    if (out.length + chunk.length > cap) { out += chunk.slice(0, Math.max(0, cap - out.length)); break; }
    out += chunk;
  }
  return out.trim();
}

/** 从回答里抽取引用页码（去重升序）。 */
export function extractCitations(text: string): ReaderCitation[] {
  const seen = new Set<number>();
  const re = /\[p\.(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n)) seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b).map((page) => ({ page }));
}

const TRANSLATE_SYS =
  "你是专业的学术翻译。把用户提供的文本忠实、通顺地翻译为简体中文；若原文已是中文，则翻译为英文。" +
  "只输出译文，不加解释、不加页码、不要编造；保留专有名词与术语准确。";

/** 划词/整篇翻译：忠实翻译给定文本（非接地、无页码引用）。 */
export async function translateText(text: string, llm: LlmClient, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const t = (text || "").trim();
  if (!t) return "";
  return llm.complete(
    [{ role: "system", content: TRANSLATE_SYS }, { role: "user", content: t }],
    { maxTokens: 1200, temperature: 0.2, signal: opts.signal },
  );
}

const SYS_BASE =
  "你是严谨的文献阅读助手。只依据下方提供的页面文本作答，不得编造、不得引入外部知识。" +
  "每一处结论/论断后用方括号页码标注来源，如 [p.3]；同一句可标多个。" +
  "若提供文本不足以回答，请直说「依据所给页面无法确定」。用简体中文，简洁。";

/** 多语言 token：拉丁词(≥3)/数字 = 跨语言锚点（专名/缩写/单位/数值）；中文段内 bigram = 同语言信号。
 *  修复：中文无空格曾被切成单一巨型 token、且中文总结↔英文原文纯字符匹配必败 → groundedRatio 恒 0。 */
function multiTokens(s: string): { anchors: string[]; cjk: string[] } {
  const t = norm(s).replace(/\[p\.\d+\]/g, " ").replace(/\*\*/g, "");
  const anchors: string[] = [];
  for (const w of (t.toLowerCase().match(/[a-z][a-z0-9+\-]{2,}/g) || [])) anchors.push(w);
  for (const n of (t.match(/\d+(?:\.\d+)?%?/g) || [])) anchors.push(n);
  const cjk: string[] = [];
  for (const run of (t.match(/[\u3400-\u9FFF]+/g) || [])) {
    if (run.length === 1) cjk.push(run);
    for (let i = 0; i + 1 < run.length; i++) cjk.push(run.slice(i, i + 2));
  }
  return { anchors, cjk };
}
/** 抽取句中页码引用 [p.X]。 */
function claimPageRefs(s: string): number[] {
  const out: number[] = []; const re = /\[p\.(\d+)\]/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) { const n = parseInt(m[1], 10); if (!Number.isNaN(n)) out.push(n); }
  return out;
}
/** 把结构化总结/回答切成可核验 claim（按行 + 句末标点；过短丢弃）。 */
function splitClaims(answer: string): string[] {
  return (answer || "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])\s*/))
    .map((x) => x.replace(/\*\*/g, "").replace(/^[\s>#*\-\d.、]+/, "").trim())
    .filter((x) => x.replace(/[\s\p{P}]/gu, "").length >= 4);
}
/**
 * 阅读器专用接地（修复 groundedRatio 恒 0）：逐 claim 核验——
 * 句中带 [p.X] 就在所引页面文本里算 content-token 覆盖率（页锚 + 覆盖，[p.X] 参与计分）；
 * 无页引用则对全篇算覆盖。比通用「逐句字符级匹配原文」更贴合分点总结。
 */
function groundReaderAnswer(answer: string, pages: ReaderPage[], opts: { hi?: number; bannerThreshold?: number } = {}): { groundedRatio: number; banner?: string } {
  const hi = opts.hi ?? 0.5;
  const pageA = new Map<number, Set<string>>(), pageC = new Map<number, Set<string>>();
  const allA = new Set<string>(), allC = new Set<string>();
  for (const p of pages) {
    const { anchors, cjk } = multiTokens(p.text);
    const a = new Set(anchors), c = new Set(cjk);
    pageA.set(p.page, a); pageC.set(p.page, c);
    for (const x of a) allA.add(x); for (const x of c) allC.add(x);
  }
  const claims = splitClaims(answer);
  if (!claims.length || (!allA.size && !allC.size)) return { groundedRatio: 0 };
  const cov = (arr: string[], set: Set<string>): number => { if (!arr.length) return 0; let i = 0; for (const x of arr) if (set.has(x)) i++; return i / arr.length; };
  let grounded = 0, scored = 0;
  for (const c of claims) {
    const { anchors, cjk } = multiTokens(c);
    if (anchors.length + cjk.length < 2) continue; // 过短/纯标记不计分
    scored++;
    const refs = claimPageRefs(c);
    let poolA = new Set<string>(), poolC = new Set<string>();
    if (refs.length) { for (const r of refs) { const a = pageA.get(r); if (a) for (const x of a) poolA.add(x); const k = pageC.get(r); if (k) for (const x of k) poolC.add(x); } }
    if (!poolA.size && !poolC.size) { poolA = allA; poolC = allC; } // 无页引用或引用页无文本 → 退回全篇
    const aCov = anchors.length ? cov(anchors, poolA) : 0;
    const cCov = cjk.length ? cov(cjk, poolC) : 0;
    // 跨语言：有锚点且锚点过半命中 → 接地；同语言：中文 bigram 过半命中 → 接地
    if ((anchors.length >= 1 && aCov >= hi) || cCov >= hi) grounded++;
  }
  const total = scored || 1;
  const groundedRatio = Math.round((grounded / total) * 100) / 100;
  const bannerThreshold = opts.bannerThreshold ?? 0.5;
  const banner = groundedRatio < bannerThreshold ? `⚠ 接地偏低（${grounded}/${total} 处可在所引页面核到）——请核对原文` : undefined;
  return { groundedRatio, banner };
}

/** 带页码引用的接地问答（页锚 RAG）。 */
export async function askReader(
  pages: ReaderPage[],
  question: string,
  llm: LlmClient,
  opts: { signal?: AbortSignal } = {},
): Promise<ReaderAnswer> {
  const picked = selectPages(pages, question, 6);
  const context = buildContext(picked);
  const answer = await llm.complete(
    [
      { role: "system", content: SYS_BASE },
      { role: "user", content: "问题：" + question + "\n\n— 页面文本 —\n" + context },
    ],
    { maxTokens: 900, temperature: 0.2, signal: opts.signal },
  );
  const g = groundReaderAnswer(answer, picked);
  return { text: answer, sourceBasis: "fulltext", model: llm.model, groundedRatio: g.groundedRatio, banner: g.banner, citations: extractCitations(answer) };
}

/** 整篇结构化接地总结（带页码引用）。 */
export async function summarizeReader(
  pages: ReaderPage[],
  llm: LlmClient,
  opts: { signal?: AbortSignal } = {},
): Promise<ReaderAnswer> {
  const context = buildContext(pages);
  const sys = SYS_BASE + "\n任务：对全文做结构化接地总结，分『研究问题 / 方法 / 主要结果 / 结论 / 局限』五点，每点后标注来源页码 [p.X]，不杜撰数字。";
  const answer = await llm.complete(
    [
      { role: "system", content: sys },
      { role: "user", content: "— 全文页面文本 —\n" + context },
    ],
    { maxTokens: 1100, temperature: 0.2, signal: opts.signal },
  );
  const g = groundReaderAnswer(answer, pages);
  return { text: answer, sourceBasis: "fulltext", model: llm.model, groundedRatio: g.groundedRatio, banner: g.banner, citations: extractCitations(answer) };
}
