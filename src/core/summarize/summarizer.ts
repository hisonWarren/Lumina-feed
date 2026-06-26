// lumina-feed · summarizer（编排：源决策 → 全文/摘要回退 → 分块归约 → 缓存 → 依据徽章）
import type { Paper } from "../model.ts";
import type {
  SummarizeOptions, SummaryResult, LlmClient, FullTextProvider, SummaryCache, StructuredSummary,
} from "./types.ts";
import { summaryCacheKey } from "./types.ts";
import { buildPrompt, buildCombinePrompt, parseStructured } from "./prompts.ts";
import { noFullText } from "./fulltext.ts";

export interface SummarizeDeps {
  llm: LlmClient;
  fullText?: FullTextProvider;
  cache?: SummaryCache;
  chunkChars?: number;          // 全文分块阈值（默认 6000）
  maxChunks?: number;           // 上限（控成本，默认 6）
  signal?: AbortSignal;
}

const isJsonDepth = (d: SummarizeOptions["depth"]) => d === "structured" || d === "clinical";

export async function summarizePaper(paper: Paper, opts: SummarizeOptions, deps: SummarizeDeps): Promise<SummaryResult | null> {
  if (opts.source === "none") return null; // 不总结，仅入库列出

  // 缓存命中（省 token/成本）
  const key = summaryCacheKey(paper.id, opts);
  if (deps.cache) { const hit = await deps.cache.get(key); if (hit) return hit; }

  const provider = deps.fullText ?? noFullText;

  // ① 决定依据文本
  let text = "";
  let basisIsFulltext = false;
  const wantFulltext = opts.source === "prefer_fulltext" && opts.fetchPdf !== "no";
  if (wantFulltext) {
    const ft = await provider.getFullText(paper, { signal: deps.signal }); // provider 内部仅取合法 OA
    if (ft && ft.text) { text = ft.text; basisIsFulltext = true; }
  }
  if (!basisIsFulltext) text = (paper.abstract ?? "").trim() || paper.title; // 回退摘要；连摘要都没有则用标题

  // ② 生成
  const raw = await generate(paper, text, basisIsFulltext, opts, deps);

  // ③ 解析 + 渲染 + caveats
  const caveats = buildCaveats(paper, basisIsFulltext, opts);
  let structured: StructuredSummary | undefined;
  let renderText = raw;
  if (isJsonDepth(opts.depth)) {
    structured = parseStructured(raw) as StructuredSummary | undefined;
    renderText = structured ? renderStructured(structured, opts.depth) : raw;
  }
  if (caveats.length && opts.depth !== "structured") renderText = `${renderText}\n\n⚠︎ ${caveats.join("；")}`;

  const result: SummaryResult = {
    text: renderText.trim(),
    sourceBasis: basisIsFulltext ? "fulltext" : "abstract",
    model: `${deps.llm.id}:${deps.llm.model}`,
    depth: opts.depth, language: opts.language, structured, caveats,
  };
  if (deps.cache) await deps.cache.put(key, result);
  return result;
}

/** 单次 or 长文分块 map-reduce */
async function generate(paper: Paper, text: string, basisIsFulltext: boolean, opts: SummarizeOptions, deps: SummarizeDeps): Promise<string> {
  const chunkChars = deps.chunkChars ?? 6000;
  if (!basisIsFulltext || text.length <= chunkChars) {
    return deps.llm.complete(buildPrompt({ paper, text, basisIsFulltext, opts }), { signal: deps.signal });
  }
  // map：逐块抽要点（统一简洁体，避免每块吐 JSON 难合并）
  const chunks = chunkText(text, chunkChars).slice(0, deps.maxChunks ?? 6);
  const partials: string[] = [];
  for (const c of chunks) {
    const msg = buildPrompt({ paper, text: c, basisIsFulltext: true, opts: { ...opts, depth: "public" } }); // 复用 public 体作"提要点"
    partials.push(await deps.llm.complete(msg, { signal: deps.signal }));
  }
  // reduce：按目标 depth 合并
  return deps.llm.complete(buildCombinePrompt(paper, partials, opts), { signal: deps.signal });
}

function buildCaveats(paper: Paper, basisIsFulltext: boolean, opts: SummarizeOptions): string[] {
  const c: string[] = [];
  if (paper.retracted) c.push("该文献已撤稿");
  if (paper.isPreprint) c.push("预印本，未经同行评议");
  if (!basisIsFulltext && opts.source === "prefer_fulltext") c.push("未获取到合法 OA 全文，基于摘要总结");
  return c;
}

export function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  const paras = text.split(/\n{2,}/);
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > size && buf) { out.push(buf); buf = p; }
    else buf = buf ? buf + "\n\n" + p : p;
    while (buf.length > size) { out.push(buf.slice(0, size)); buf = buf.slice(size); }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

function renderStructured(s: StructuredSummary, depth: SummarizeOptions["depth"]): string {
  const row = (label: string, v?: string) => (v && v !== "null" ? `${label}：${v}` : "");
  const lines = [
    row("目的", s.purpose), row("方法", s.methods), row("结果", s.results),
    row("结论", s.conclusion), row("局限", s.limitations),
    [row("样本量", s.sampleSize), row("研究类型", s.studyType)].filter(Boolean).join(" · "),
  ];
  if (depth === "clinical") lines.push([row("可能改变实践", s.practiceChanging), row("证据强度", s.evidenceStrength)].filter(Boolean).join(" · "));
  return lines.filter(Boolean).join("\n");
}

/** 批量总结（控并发；默认串行省成本，可调 concurrency） */
export async function summarizeMany(
  papers: Paper[], opts: SummarizeOptions, deps: SummarizeDeps, concurrency = 2,
): Promise<Map<string, SummaryResult>> {
  const out = new Map<string, SummaryResult>();
  const queue = [...papers];
  async function worker() {
    while (queue.length) {
      const p = queue.shift()!;
      try { const r = await summarizePaper(p, opts, deps); if (r) out.set(p.id, r); }
      catch { /* 单篇失败不拖垮整批 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, papers.length || 1) }, worker));
  return out;
}
