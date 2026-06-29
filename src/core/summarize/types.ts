// lumina-feed · M4 总结管线 · 类型
import type { Paper } from "../model.ts";

/** 总结选项（直接映射 N-S 全套） */
export interface SummarizeOptions {
  source: "abstract_only" | "prefer_fulltext" | "none";
  fetchPdf: "yes" | "no" | "if_oa";
  depth: "tldr" | "structured" | "clinical" | "public";
  language: "zh" | "en" | "bilingual";
  scope: "digest_hits" | "whole_list" | "manual";
}

export const DEFAULT_SUMMARIZE: SummarizeOptions = {
  source: "prefer_fulltext", fetchPdf: "if_oa", depth: "tldr", language: "zh", scope: "digest_hits",
};

/** 结构化模板的稳定 JSON schema（R-ML：目的/方法/结果/结论/局限/样本量/研究类型） */
export interface StructuredSummary {
  purpose?: string;
  methods?: string;
  results?: string;
  conclusion?: string;
  limitations?: string;
  sampleSize?: string;
  studyType?: string;
  /** 临床模板附加：是否可能改变实践 + 证据强度（仅作提示，非裁决） */
  practiceChanging?: string;
  evidenceStrength?: string;
}

export interface SummaryResult {
  text: string;                         // 人类可读渲染（始终有）
  sourceBasis: "fulltext" | "abstract"; // 反幻觉依据徽章（N-S5）
  model: string;
  depth: SummarizeOptions["depth"];
  language: SummarizeOptions["language"];
  structured?: StructuredSummary;       // structured/clinical 时解析所得
  caveats: string[];                    // 如「未经同行评议」「已撤稿」「基于摘要，全文未获取」
}

// ── 可插拔 LLM ──
export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmCompleteOpts { maxTokens?: number; temperature?: number; signal?: AbortSignal; images?: string[]; /** DeepSeek V4：显式开 thinking；默认关（简报/总结走 content） */ thinking?: boolean }
export interface LlmClient {
  id: "anthropic" | "openai" | "ollama" | string;
  model: string;
  complete(messages: LlmMessage[], opts?: LlmCompleteOpts): Promise<string>;
}

// ── 全文提供者（M3 实装，这里注入）──
export interface FullTextResult { text: string; url: string }
export interface FullTextProvider {
  /** 取全文文本；取不到 → 返回 null（强制回退摘要） */
  getFullText(paper: Paper, opts?: { signal?: AbortSignal }): Promise<FullTextResult | null>;
}

// ── 总结缓存（默认走 summaries 表；省 token/成本，ADR-3）──
export interface SummaryCache {
  get(key: string): SummaryResult | null | Promise<SummaryResult | null>;
  put(key: string, value: SummaryResult): void | Promise<void>;
}

export function summaryCacheKey(paperId: string, opts: SummarizeOptions): string {
  return `${paperId}|${opts.depth}|${opts.language}`;
}
