// 订阅简报 · AI 集成（blurb / 自动总结 / 进度 / 元数据）
import type { Paper } from "../model.ts";
import type { SummarizeOptions, LlmClient } from "../summarize/types.ts";
import { DEFAULT_SUMMARIZE } from "../summarize/types.ts";
import type { Store } from "../store/index.ts";

/** 单次 run 的 AI 处理上限（today 上限对齐） */
export const DIGEST_AI_CAP = 50;
export const DIGEST_AI_TOP_N = 10;
export const DIGEST_PREVIEW_BLURB_SAMPLES = 2;

export type DigestAiMode = "blurb" | "abstract" | "topN";

export interface DigestAiProgress {
  subId: string;
  phase: "search" | "ai";
  mode: DigestAiMode | "off";
  current: number;
  total: number;
  label: string;
}

export interface DigestAiMeta {
  status: "skipped" | "ok" | "partial" | "failed" | "queued";
  mode: string;
  processed: number;
  total: number;
  blurbs: number;
  summaries: number;
  skippedReason?: string;
  errors?: number;
}

export type DigestAiProgressFn = (p: DigestAiProgress) => void;

export function paperHasBlurb(p: Paper | Record<string, unknown>): boolean {
  return !!(p._digestBlurb || (p as { digestBlurb?: string }).digestBlurb);
}

export function pickBlurbTargets(papers: Paper[], cap = DIGEST_AI_CAP): Paper[] {
  return papers.filter((p) => !paperHasBlurb(p)).slice(0, cap);
}

export function pickAbstractTargets(fresh: Paper[], cap = DIGEST_AI_CAP): Paper[] {
  return fresh.slice(0, cap);
}

export function pickTopNTargets(fresh: Paper[], n = DIGEST_AI_TOP_N): Paper[] {
  return fresh.slice(0, n);
}

export function digestSummarizeOpts(mode: "abstract" | "topN"): SummarizeOptions {
  if (mode === "abstract") {
    return { ...DEFAULT_SUMMARIZE, source: "abstract_only", fetchPdf: "no", depth: "tldr", scope: "digest_hits" };
  }
  return { ...DEFAULT_SUMMARIZE, depth: "tldr", scope: "digest_hits" };
}

export function mergeAiOntoToday(today: Paper[], patchById: Map<string, Record<string, unknown>>): Paper[] {
  return today.map((p) => {
    const patch = patchById.get(p.id);
    return patch ? ({ ...p, ...patch } as Paper) : p;
  });
}

export async function generateDigestBlurb(
  pp: { title?: string; abstract?: string },
  sub: Record<string, unknown>,
  llm: LlmClient,
): Promise<string | undefined> {
  const topic = String(sub.name || sub.q || "订阅主题").slice(0, 120);
  const title = String(pp.title || "").slice(0, 200);
  const abs = String(pp.abstract || "").slice(0, 400);
  try {
    const text = await llm.complete([
      { role: "system", content: "你是学术文献简报助手。用一句中文（≤40字）说明该论文与订阅主题的相关点。不要建议纳入或排除研究。不要列表。" },
      { role: "user", content: `订阅：${topic}\n标题：${title}\n摘要：${abs}` },
    ], { maxTokens: 80, temperature: 0.2 });
    return text?.trim().slice(0, 120) || undefined;
  } catch {
    return undefined;
  }
}

export function readCachedSummary(
  db: Store["db"],
  paperId: string,
  depth = "tldr",
  language = "zh",
): { text: string; sourceBasis: "fulltext" | "abstract"; model: string } | null {
  try {
    const r = db.prepare(
      "SELECT text, source_basis, model FROM summaries WHERE paper_id=? AND depth=? AND language=? ORDER BY created_at DESC LIMIT 1",
    ).get(paperId, depth, language) as { text?: string; source_basis?: string; model?: string } | undefined;
    if (!r?.text) return null;
    return {
      text: r.text,
      sourceBasis: r.source_basis === "fulltext" ? "fulltext" : "abstract",
      model: r.model || "",
    };
  } catch {
    return null;
  }
}
