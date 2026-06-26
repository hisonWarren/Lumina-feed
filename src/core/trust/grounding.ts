// lumina-feed · 证据可信性 · 确定性 grounding（永远跑，零 LLM 调用）
// 每句 → 源文最佳支撑片段（字符偏移）+ grounded 分；数字保真核验。
// ADR-T1：数字不符强制降级；ADR-T3：只留偏移 + 短引用。
import { splitSentences, extractNumbers, numericCores, sourceNumberSet, tokenize, ngrams } from "./segment.ts";

export type ClaimStatus = "grounded" | "weak" | "unsupported";

export interface Span { start: number; end: number; quote: string }
export interface Claim {
  text: string;
  status: ClaimStatus;
  score: number;             // 0..1 与最佳片段的相似度
  span?: Span;               // 支撑片段在源文中的偏移 + 短引用
  numbersOk: boolean;        // 句中数字是否都在源文出现
  missingNumbers: string[];  // 凭空出现的数字（最危险）
}

export interface GroundingOptions {
  hi?: number;               // ≥hi → grounded（默认 0.5）
  lo?: number;               // ≥lo 且 <hi → weak（默认 0.22）
  windowChars?: number;      // 源文滑窗大小（默认 220）
  stride?: number;           // 滑窗步长（默认 110）
  maxQuoteChars?: number;    // 短引用上限（默认 160；最小留痕）
}

interface Window { start: number; end: number; text: string; toks: string[]; grams: Set<string> }

function buildWindows(source: string, size: number, stride: number): Window[] {
  const wins: Window[] = [];
  if (!source) return wins;
  for (let i = 0; i < source.length; i += stride) {
    const slice = source.slice(i, i + size);
    const toks = tokenize(slice);
    wins.push({ start: i, end: Math.min(i + size, source.length), text: slice, toks, grams: new Set(ngrams(toks, 3)) });
    if (i + size >= source.length) break;
  }
  return wins;
}

/** 覆盖率：claim 的元素有多少落在窗口里（|claim ∩ win| / |claim|）。
 *  比对称 Jaccard 更适合「这句话是否被某片段支撑」——不被窗口大小稀释。 */
function coverage(claim: Set<string>, win: Set<string>): number {
  if (!claim.size) return 0;
  let inter = 0; for (const x of claim) if (win.has(x)) inter++;
  return inter / claim.size;
}

/** 对单句在源文打分（token 覆盖率 0.5 + 3-gram 覆盖率 0.5），返回最佳窗口。 */
function bestWindow(claim: string, wins: Window[]): { score: number; win?: Window } {
  const cToks = new Set(tokenize(claim));
  const cGrams = new Set(ngrams([...cToks], 3));
  let best = { score: 0, win: undefined as Window | undefined };
  for (const w of wins) {
    const tokSim = coverage(cToks, new Set(w.toks));
    const gramSim = cGrams.size ? coverage(cGrams, w.grams) : 0;
    const score = 0.5 * tokSim + 0.5 * gramSim;
    if (score > best.score) best = { score, win: w };
  }
  return best;
}

/** 在窗口内截取贴合 claim 的短引用（最小留痕）。 */
function pickQuote(claim: string, win: Window, maxQ: number): Span {
  // 用 claim 的若干 token 在窗口里定位一个收紧的区间
  const cToks = tokenize(claim);
  let first = -1, last = -1;
  const lowWin = win.text.toLowerCase();
  for (const t of cToks) {
    const idx = lowWin.indexOf(t);
    if (idx >= 0) { if (first < 0 || idx < first) first = idx; const e = idx + t.length; if (e > last) last = e; }
  }
  let s = first >= 0 ? first : 0;
  let e = last > s ? last : Math.min(win.text.length, maxQ);
  // 扩到词边界 + 限长
  if (e - s > maxQ) e = s + maxQ;
  const quote = win.text.slice(s, e).trim();
  return { start: win.start + s, end: win.start + s + quote.length, quote };
}

/** 数字保真核验：claim 中每个数字本体是否都在源文出现。 */
function checkNumbers(claim: string, srcNums: Set<string>): { ok: boolean; missing: string[] } {
  const tokens = extractNumbers(claim);
  const missing: string[] = [];
  for (const tok of tokens) {
    const cores = numericCores(tok);
    for (const c of cores) {
      // 允许出现在源文数字集合中（精确）或作为子串（如 0.75 出现在 0.756）
      const present = srcNums.has(c) || [...srcNums].some((s) => s.includes(c) || c.includes(s));
      if (!present) missing.push(c);
    }
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

/** 对整段总结做确定性 grounding。 */
export function groundSummary(summary: string, source: string, opts: GroundingOptions = {}): Claim[] {
  const hi = opts.hi ?? 0.5, lo = opts.lo ?? 0.22;
  const wins = buildWindows(source, opts.windowChars ?? 220, opts.stride ?? 110);
  const srcNums = sourceNumberSet(source);
  const maxQ = opts.maxQuoteChars ?? 160;

  return splitSentences(summary).map((text) => {
    const { score, win } = bestWindow(text, wins);
    const nums = checkNumbers(text, srcNums);
    let status: ClaimStatus = score >= hi ? "grounded" : score >= lo ? "weak" : "unsupported";
    // ADR-T1：数字凭空出现 → 强制降级（无论词面多像）
    if (!nums.ok && status === "grounded") status = "weak";
    const span = win ? pickQuote(text, win, maxQ) : undefined;
    return { text, status, score: Math.round(score * 1000) / 1000, span, numbersOk: nums.ok, missingNumbers: nums.missing };
  });
}
