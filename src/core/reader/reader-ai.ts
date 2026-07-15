// lumina-feed · 阅读器接地 AI —— patch: reader_engine
// 对"当前打开 PDF 的逐页文本"做接地总结 / 问答，附可点击页码引用 [p.X]。
// 复用 LlmClient.complete + 阅读器专用页锚接地（groundReaderAnswer，按 claim 在引用页切片内核验）。红线：只单篇、必带 sourceBasis、带页码引用、不杜撰。
import type { LlmClient } from "../summarize/types.ts";

export interface ReaderPage { page: number; text: string }
export interface ReaderCitation { page: number }
export type ReaderSourceBasis = "fulltext" | "pages" | "abstract" | "mixed" | "external";
export type AskMode = "paper" | "general";

export interface ReaderAnswer {
  text: string;
  sourceBasis: ReaderSourceBasis; // fulltext=全文管线；pages=仅部分页；mixed=文中+背景；external=外部知识
  model: string;
  groundedRatio: number;
  banner?: string;
  citations: ReaderCitation[];
  pageCount?: number;
  pagesUsed?: number;
}

/** 浅多轮：上一轮问答（仅传问题 + 带页码要点，不传长段 AI 散文）。 */
export interface ReaderQaTurn { q: string; a?: string }
/** 制品记忆：本篇已生成的总结/大纲摘录（仅助指代，非证据）。 */
export interface ReaderAskArtifacts { summary?: string; outline?: string }
export interface AskReaderOpts {
  signal?: AbortSignal;
  priorTurns?: ReaderQaTurn[];
  artifacts?: ReaderAskArtifacts;
  /** paper=仅据本文（默认）；general=可借外部知识，须诚实标注 */
  mode?: AskMode;
}

export const ASK_PRIOR_TURN_CAP = 2;

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
  "输入常来自学术论文 PDF 单页：跳过页眉页脚、页码、期刊名、重复栏目标签、版权行；作者与单位可极简处理或省略；" +
  "着重翻译摘要、章节标题与正文段落。段落之间用空行分隔；只输出译文，不加解释、不加页码、不要编造；保留专有名词与术语准确。" +
  "不要使用 Markdown 或 ** 加粗标记；章节小标题单独成行即可（如「摘要」「引言」）。";

/** 划词/整篇翻译：忠实翻译给定文本（非接地、无页码引用）。长页按段落分块，避免输出 token 截断漏译。 */
function translateMaxTokens(inputChars: number): number {
  return Math.min(4096, Math.max(1400, Math.ceil(inputChars * 0.85) + 320));
}

async function translateOneChunk(text: string, llm: LlmClient, opts: { signal?: AbortSignal }): Promise<string> {
  return llm.complete(
    [{ role: "system", content: TRANSLATE_SYS }, { role: "user", content: text }],
    { maxTokens: translateMaxTokens(text.length), temperature: 0.2, signal: opts.signal },
  );
}

export async function translateText(text: string, llm: LlmClient, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const t = (text || "").trim();
  if (!t) return "";
  const CHUNK = 2400;
  if (t.length <= CHUNK) return translateOneChunk(t, llm, opts);
  const paras = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && (buf.length + p.length + 2) > CHUNK) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  const outs: string[] = [];
  for (const c of chunks) {
    outs.push(await translateOneChunk(c, llm, opts));
  }
  return outs.join("\n\n");
}

const SYS_BASE =
  "你是严谨的文献阅读助手。只依据下方提供的页面文本作答，不得编造、不得引入外部知识。" +
  "每一处结论/论断后用方括号页码标注来源，如 [p.3]；同一句可标多个。" +
  "若提供文本不足以回答，请直说「依据所给页面无法确定」。用简体中文，简洁。";

/** 可借外部知识：背景不得伪造页码；文中论断仍须 [p.X]。 */
const SYS_GENERAL =
  "你是学术阅读助手。可结合开放世界知识与下方可选的论文页面文本作答。" +
  "凡直接依据论文正文的论断必须用方括号页码标注，如 [p.3]；同一句可标多个。" +
  "纯背景知识、学科常识、术语释义不得标注页码，并在该句或该段开头用「（背景）」标明。" +
  "严禁为外部知识伪造页码。用简体中文，简洁。";

const MEMORY_SYS =
  "\n若附有「前文要点」或「本篇制品」，仅用于理解指代（如「它」「刚才」「第二点」指什么）；" +
  "最终论断必须仍依据页面文本重新核验并标注页码，不得把前文或制品当作证据。";

const MEMORY_SYS_GENERAL =
  "\n若附有「前文要点」或「本篇制品」，可用于理解指代；文中论断仍须按页面核验并标 [p.X]，背景知识标「（背景）」且不得伪造页码。";

/** 从上一轮回答抽取带页码的要点行（L2 浅记忆，上限 4 条）。 */
function extractGroundedSnippets(answer: string, maxSnippets = 4): string {
  const claims = splitClaims(answer).filter((c) => /\[p\.\d+\]/.test(c));
  if (claims.length) return claims.slice(0, maxSnippets).join("\n");
  return (answer || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

/** 组装 L1 制品 + L2 浅多轮记忆块（供 askReader 注入 prompt）。 */
export function buildAskMemoryBlock(priorTurns?: ReaderQaTurn[], artifacts?: ReaderAskArtifacts): string {
  const parts: string[] = [];
  const turns = (priorTurns || []).slice(-ASK_PRIOR_TURN_CAP).filter((t) => t && (t.q || "").trim());
  if (turns.length) {
    const lines = turns.map((t, i) => {
      const snips = t.a ? extractGroundedSnippets(t.a) : "";
      return `第${i + 1}轮问：${(t.q || "").trim()}` + (snips ? `\n已核要点（仅供指代）：\n${snips}` : "");
    });
    parts.push("— 前文问答（仅助指代，非证据）—\n" + lines.join("\n\n"));
  }
  if (artifacts?.summary) {
    parts.push("— 本篇接地总结摘录（仅助指代，非证据）—\n" + artifacts.summary.slice(0, 900));
  }
  if (artifacts?.outline) {
    parts.push("— 本篇逻辑大纲摘录（仅助指代，非证据）—\n" + artifacts.outline.slice(0, 600));
  }
  return parts.join("\n\n").trim();
}

/** 多语言 token：拉丁词(≥3)/数字 = 跨语言锚点（专名/缩写/单位/数值）；中文段内 bigram = 同语言信号。
 *  修复：中文无空格曾被切成单一巨型 token、且中文总结↔英文原文纯字符匹配必败 → groundedRatio 恒 0。 */
function multiTokens(s: string): { anchors: string[]; cjk: string[] } {
  const t = norm(s).replace(/\[p\.\d+\]/g, " ").replace(/\*\*/g, "");
  const anchors: string[] = [];
  for (const w of (t.toLowerCase().match(/[a-z][a-z0-9+\-]{2,}/g) || [])) anchors.push(w);
  for (const n of (t.match(/\d+(?:\.\d+)?(?:ms|s|hz|khz|mhz|%)?/gi) || [])) anchors.push(n.toLowerCase());
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
  const uncertainty = /依据所给页面无法确定|无法从所给|文本不足以回答/.test(answer || "");
  const banner = !uncertainty && groundedRatio < bannerThreshold ? `⚠ 接地偏低（${grounded}/${total} 处可在所引页面核到）——请核对原文` : undefined;
  return { groundedRatio, banner };
}

/** 从长问题中抽出定位子句（用户常先贴背景再问「200ms在哪提到」）。 */
export function extractLocateQuery(question: string): string {
  const q = String(question || "").trim();
  if (!q) return q;
  const tail = q.match(/(?:^|[。！？\n])([^。！？\n]{0,120}(?:哪里|哪一|何处|在哪|哪页).{0,80}(?:提到|出现|写到)[^。！？\n]*)[。！？]?\s*$/);
  if (tail?.[1]) return tail[1].trim();
  const msTail = q.match(/(?:^|[。！？\n])([^。！？\n]*\d+\s*ms[^。！？\n]{0,60}(?:在哪|哪里|提到|出现)[^。！？\n]*)[。！？]?\s*$/i);
  if (msTail?.[1]) return msTail[1].trim();
  return q;
}

function normalizeAnswerCites(text: string): string {
  return String(text || "").replace(/\bp\.\s*(\d+)\b/gi, "[p.$1]");
}

/** 从定位类问题中抽取可在 PDF 文本里检索的锚点（数值+单位、引号内短语、英文专名）。 */
export function extractSearchNeedles(question: string): string[] {
  const q = extractLocateQuery(question);
  const out = new Set<string>();
  for (const m of q.matchAll(/\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds?|Hz|kHz|MHz|%|mm|cm|m|分钟|秒)?/gi)) {
    const raw = m[0].trim();
    if (!raw) continue;
    out.add(raw);
    out.add(raw.replace(/\s+/g, "").toLowerCase());
    const num = raw.match(/\d+(?:\.\d+)?/);
    if (num) out.add(num[0]);
  }
  for (const m of q.matchAll(/[「"']([^」"']{2,48})[」"']/g)) out.add(m[1].trim());
  if (/(哪里|何处|哪一|提到|出现|在哪)/i.test(q)) {
    for (const m of q.matchAll(/\b[A-Za-z][A-Za-z0-9+\-]{2,}\b/g)) {
      if (m[0].length <= 24) out.add(m[0]);
    }
  }
  return [...out].filter((x) => x.replace(/\s/g, "").length >= 2);
}

function compactForMatch(s: string): string {
  return norm(s).toLowerCase().replace(/\s+/g, "");
}

export function findNeedlesInPages(pages: ReaderPage[], needles: string[]): Array<{ page: number; snippet: string; needle: string }> {
  const hits: Array<{ page: number; snippet: string; needle: string }> = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const compact = compactForMatch(p.text || "");
    if (!compact) continue;
    for (const needle of needles) {
      const n = compactForMatch(needle);
      if (n.length < 2) continue;
      const idx = compact.indexOf(n);
      if (idx < 0) continue;
      const key = `${p.page}:${n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = p.text || "";
      const approx = Math.max(0, Math.min(raw.length - 1, Math.floor((idx / Math.max(1, compact.length)) * raw.length)));
      const start = Math.max(0, approx - 48);
      hits.push({ page: p.page, snippet: raw.slice(start, start + 140).trim(), needle });
      break;
    }
  }
  return hits.sort((a, b) => a.page - b.page);
}

function isLocateQuestion(question: string): boolean {
  const q = extractLocateQuery(question);
  return /(哪里|何处|哪一|哪页|提到|出现|在哪|where|mention|locat)/i.test(q || "");
}

/** 定位类问题：先在全文检索锚点，命中则直接返回带页码的接地回答，避免 LLM 误报「无法确定」。 */
export function tryLocateAnswer(pages: ReaderPage[], question: string): string | null {
  const locateQ = extractLocateQuery(question);
  if (!isLocateQuestion(locateQ)) return null;
  const needles = extractSearchNeedles(locateQ);
  if (!needles.length) return null;
  const hits = findNeedlesInPages(pages, needles);
  if (!hits.length) return null;
  const uniq = [...new Set(hits.map((h) => h.needle))];
  const lines = hits.map((h) => `第 ${h.page} 页原文：「${norm(h.snippet)}」[p.${h.page}]`);
  return `关于「${uniq.join("、")}」在文中的位置：\n` + lines.join("\n");
}

const ONE_PASS_CAP = 16000; // 单次直送字符上限（小文档一次过即可）
const MAP_CHUNK = 8000;     // 每个 map 分片字符上限
const MAX_CHUNKS = 16;      // map 分片数上限（长文档尽量覆盖全篇）

export function totalChars(pages: ReaderPage[]): number { let n = 0; for (const p of pages) n += (p.text || "").length; return n; }
// 按页边界切片：每片连续若干页、累计不超过 chunkCap；片数不超过 maxChunks（超出则尾页并入最后一片）。页码锚不跨片错位。
export function chunkByPages(pages: ReaderPage[], chunkCap: number, maxChunks: number): ReaderPage[][] {
  const chunks: ReaderPage[][] = []; let cur: ReaderPage[] = []; let curLen = 0;
  for (const p of pages) {
    const len = (p.text || "").length + 8;
    if (cur.length && curLen + len > chunkCap && chunks.length < maxChunks - 1) { chunks.push(cur); cur = []; curLen = 0; }
    cur.push(p); curLen += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** 预设/常见问法 → 优先检索的章节信号（用于中篇单次过时的页序加权，非替代全文）。 */
const INTENT_HINTS: [RegExp, string[]][] = [
  [/主要发现|核心结果|主要结果|贡献/, ["result", "finding", "discussion", "conclusion", "结果", "讨论", "结论"]],
  [/方法|怎么做的|研究设计|procedure|method/i, ["method", "material", "participant", "方法", "材料", "被试", "样本"]],
  [/样本|研究类型|队列|n\s*=|participants/i, ["participant", "sample", "cohort", "subject", "被试", "样本", "队列"]],
  [/局限|限制|不足|weakness|limitation/i, ["limitation", "discussion", "future", "局限", "讨论", "不足"]],
];

function intentBoostPages(pages: ReaderPage[], question: string, k: number): ReaderPage[] {
  const q = question || "";
  let hints: string[] = [];
  for (const [re, hs] of INTENT_HINTS) if (re.test(q)) hints = hints.concat(hs);
  if (!hints.length) return selectPages(pages, question, k);
  const scored = pages.map((p) => {
    const t = norm(p.text).toLowerCase();
    let s = 0;
    for (const h of hints) if (t.includes(h.toLowerCase())) s += 3;
    for (const tok of tokens(q)) if (t.includes(tok)) s += 1;
    return { p, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, k).filter((x) => x.s > 0).map((x) => x.p);
  const chosen = top.length ? top : selectPages(pages, question, k);
  return chosen.slice().sort((a, b) => a.page - b.page);
}

const MAP_Q_SYS =
  "你在为一篇学术论文做分段要点抽取。只依据给你的这部分页面文本，抽取与「用户问题」相关的要点；每条一行，行末用方括号标注该信息所在的真实页码（如 [p.5]）。只列要点、不写总起、不评论、不杜撰数字。若本片没有相关要点，只回复「（无）」。用简体中文。";

async function mapChunkForQuestion(pages: ReaderPage[], question: string, llm: LlmClient, signal?: AbortSignal): Promise<string> {
  const ctx = buildContext(pages, MAP_CHUNK + 2000);
  const out = await llm.complete(
    [
      { role: "system", content: MAP_Q_SYS },
      { role: "user", content: "用户问题：" + question + "\n\n— 论文片段（页面文本）—\n" + ctx },
    ],
    { maxTokens: 700, temperature: 0.2, signal },
  );
  return (out || "").trim();
}

/** 组装问答正文：小文档全文单次过；长文档 map-reduce 覆盖全篇（与总结同策略，避免只盯前 1–2 页）。 */
async function composeAnswerText(
  pages: ReaderPage[],
  question: string,
  llm: LlmClient,
  signal?: AbortSignal,
  memoryBlock?: string,
  mode: AskMode = "paper",
): Promise<string> {
  const qq = (question || "").trim();
  const mem = (memoryBlock || "").trim();
  const memPrefix = mem ? mem + "\n\n" : "";
  const general = mode === "general";
  const baseSys = general ? SYS_GENERAL : SYS_BASE;
  const memSys = mem ? (general ? MEMORY_SYS_GENERAL : MEMORY_SYS) : "";
  const locateQ = extractLocateQuery(qq);
  const locateHint = !general && isLocateQuestion(locateQ)
    ? "\n这是定位类问题：只引用原文中与锚点词（如数值/单位）直接相关的句子，附 [p.X]；不要复述用户问题里的背景；找不到才说「依据所给页面无法确定」。"
    : "";
  if (totalChars(pages) <= ONE_PASS_CAP) {
    const sys = general
      ? baseSys + memSys +
        "\n任务：回答用户问题。可依据下方论文页面与必要背景知识；文中论断标真实页码 [p.X]，背景标「（背景）」且不伪造页码。"
      : baseSys + memSys +
        "\n任务：依据下方提供的论文页面文本，直接回答用户问题；每一处论断后标注信息实际所在的页码 [p.X]（信息在哪页就标哪页，不要把所有点都标第 1 页）。若文本不足以回答，请直说「依据所给页面无法确定」。"
        + locateHint;
    return await llm.complete(
      [
        { role: "system", content: sys },
        { role: "user", content: memPrefix + "问题：" + qq + "\n\n— 全文页面文本 —\n" + buildContext(pages, ONE_PASS_CAP) },
      ],
      { maxTokens: 1000, temperature: 0.2, signal },
    );
  }
  const chunks = chunkByPages(pages, MAP_CHUNK, MAX_CHUNKS);
  const mapped = await Promise.all(chunks.map((c) => mapChunkForQuestion(c, qq, llm, signal).catch(() => "")));
  const notes = mapped.map((m) => (m && m !== "（无）" ? m : "")).filter(Boolean).join("\n");
  const reduceSys = general
    ? baseSys + memSys +
      "\n下面是从全文各部分抽取的相关要点（带页码）。请回答用户问题：文中论断保留真实 [p.X]；需要的背景知识标「（背景）」且不得伪造页码；不得把背景写成论文原文。"
    : baseSys + memSys +
      "\n下面是从全文各部分抽取的、与用户问题相关的要点清单（带页码）。请据此直接回答问题；每处论断保留并标注它所依据的真实页码 [p.X]（沿用要点里的页码，不要一律标第 1 页）；只用要点中的信息，不杜撰数字、不引入要点之外的内容。若要点不足以回答，请直说「依据所给页面无法确定」。"
      + locateHint;
  return await llm.complete(
    [
      { role: "system", content: reduceSys },
      { role: "user", content: memPrefix + "问题：" + qq + "\n\n— 全文各部分要点（带页码）—\n" + (notes || "（未抽出要点）") },
    ],
    { maxTokens: 1100, temperature: 0.2, signal },
  );
}

/** 带页码引用的接地问答（全文 map-reduce / 小文档全文；接地对全篇核验）。 */
export async function askReader(
  pages: ReaderPage[],
  question: string,
  llm: LlmClient,
  opts: AskReaderOpts = {},
): Promise<ReaderAnswer> {
  const mode: AskMode = opts.mode === "general" ? "general" : "paper";
  const memoryBlock = buildAskMemoryBlock(opts.priorTurns, opts.artifacts);
  const located = mode === "paper" ? tryLocateAnswer(pages, question) : null;
  const raw = located ?? await composeAnswerText(pages, question, llm, opts.signal, memoryBlock || undefined, mode);
  const answer = normalizeAnswerCites(raw);
  const citations = extractCitations(answer);
  if (mode === "general") {
    const hasBg = /（背景）|\(背景\)/.test(answer);
    if (!citations.length) {
      return {
        text: answer,
        sourceBasis: "external",
        model: llm.model,
        groundedRatio: 1,
        banner: hasBg ? undefined : "○ 本题以外部知识为主——未引用本文页码",
        citations: [],
        pageCount: pages.length,
        pagesUsed: 0,
      };
    }
    const g = groundReaderAnswer(answer, pages);
    return {
      text: answer,
      sourceBasis: "mixed",
      model: llm.model,
      groundedRatio: g.groundedRatio,
      banner: g.banner || (hasBg ? "◐ 文中引用已接地；带「（背景）」处为外部知识" : undefined),
      citations,
      pageCount: pages.length,
      pagesUsed: pages.length,
    };
  }
  const g = groundReaderAnswer(answer, pages);
  return {
    text: answer,
    sourceBasis: "fulltext",
    model: llm.model,
    groundedRatio: g.groundedRatio,
    banner: g.banner,
    citations,
    pageCount: pages.length,
    pagesUsed: pages.length,
  };
}

/** 整篇结构化接地总结（带页码引用）。
 *  修复「只总结第 1 页 / 引用全标 p.1 / 接地偏低」：旧版把全文截到 12000 字符（≈ 摘要页）再一次过，
 *  模型只看得到首页摘要、于是把一切都标 p.1，后段细节（如 378 FNC 特征在 p.5）既没进上下文、也核不到 → 接地掉到 4 成。
 *  新版：小文档照旧单次过；长文档走 map-reduce——按页分片各自抽「带真实页码的要点」（并发），再汇总成五段，
 *  汇总时强制「信息在哪页就标哪页，不要一律标 p.1」。覆盖全篇 + 页码落到细节页 → 接地随之回升。红线不变：单篇、sourceBasis:fulltext、带页码、不杜撰。 */
const MAP_SYS = "你在为一篇学术论文做分段要点抽取。只依据给你的这部分页面文本，抽取与『研究问题 / 方法 / 数据 / 主要结果 / 结论 / 局限』相关的要点；每条一行，行末用方括号标注该信息所在页码（如 [p.5]，用文本里给出的真实页码）。只列要点、不写总起、不评论、不杜撰数字。若本片没有相关要点，只回复「（无）」。用简体中文。";

async function mapChunk(pages: ReaderPage[], llm: LlmClient, signal?: AbortSignal): Promise<string> {
  const ctx = buildContext(pages, MAP_CHUNK + 2000);
  const out = await llm.complete(
    [ { role: "system", content: MAP_SYS }, { role: "user", content: "— 论文片段（页面文本）—\n" + ctx } ],
    { maxTokens: 700, temperature: 0.2, signal },
  );
  return (out || "").trim();
}

// 组装总结正文（小文档单次过 / 长文档 map-reduce），不做接地——接地由 summarizeReader 紧接着统一处理。
async function composeSummaryText(pages: ReaderPage[], llm: LlmClient, signal?: AbortSignal): Promise<string> {
  if (totalChars(pages) <= ONE_PASS_CAP) {
    // 小文档：单次过，但同样要求「信息在哪页标哪页，不要一律标 p.1」。
    const sys = SYS_BASE + "\n任务：对全文做结构化接地总结，分『研究问题 / 方法 / 主要结果 / 结论 / 局限』五点，每点后标注信息实际所在的页码 [p.X]（信息在哪页就标哪页，不要把所有点都标第 1 页），不杜撰数字。";
    return await llm.complete(
      [ { role: "system", content: sys }, { role: "user", content: "— 全文页面文本 —\n" + buildContext(pages, ONE_PASS_CAP) } ],
      { maxTokens: 1100, temperature: 0.2, signal },
    );
  }
  // 长文档：map（并发抽要点）→ reduce（汇成五段，保留真实页码）。
  const chunks = chunkByPages(pages, MAP_CHUNK, MAX_CHUNKS);
  const mapped = await Promise.all(chunks.map((c) => mapChunk(c, llm, signal).catch(() => "")));
  const notes = mapped.map((m) => m && m !== "（无）" ? m : "").filter(Boolean).join("\n");
  const reduceSys = SYS_BASE + "\n下面是从全文各部分抽取的、带页码的要点清单。请据此整理成结构化接地总结，分『研究问题 / 方法 / 主要结果 / 结论 / 局限』五点；每点后保留并标注它所依据的页码 [p.X]（沿用要点里给出的真实页码，信息在哪页就标哪页，不要一律标第 1 页）；只用要点中的信息，不杜撰数字、不引入要点之外的内容。";
  return await llm.complete(
    [ { role: "system", content: reduceSys }, { role: "user", content: "— 全文各部分要点（带页码）—\n" + (notes || "（未抽出要点）") } ],
    { maxTokens: 1200, temperature: 0.2, signal },
  );
}

export async function summarizeReader(
  pages: ReaderPage[],
  llm: LlmClient,
  opts: { signal?: AbortSignal } = {},
): Promise<ReaderAnswer> {
  const answer = await composeSummaryText(pages, llm, opts.signal);
  const g = groundReaderAnswer(answer, pages);
  return { text: answer, sourceBasis: "fulltext", model: llm.model, groundedRatio: g.groundedRatio, banner: g.banner, citations: extractCitations(answer), pageCount: pages.length, pagesUsed: pages.length };
}
