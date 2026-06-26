// lumina-feed · 证据可信性 · 汇总导出 + 与 M4 集成
import type { Paper } from "../model.ts";
import type { SummarizeOptions } from "../summarize/types.ts";
import { summarizePaper, type SummarizeDeps } from "../summarize/summarizer.ts";
import { buildGroundedSummary, type GroundedSummary, type GroundConfig } from "./grounded-summary.ts";

export * from "./segment.ts";
export * from "./grounding.ts";
export * from "./verifier.ts";
export * from "./grounded-summary.ts";
export * from "./audit.ts";

export interface GroundedResult {
  summaryText: string;
  sourceBasis: "fulltext" | "abstract";
  model: string;
  grounded: GroundedSummary;
}

/** 包 M4 summarizePaper：生成总结后，对「实际所依据的源文本」做 grounding。
 *  ADR：总结依据什么文本，就 ground 什么文本（fulltext 时用全文，abstract 时用摘要）。 */
export async function summarizeGrounded(
  paper: Paper,
  opts: SummarizeOptions,
  deps: SummarizeDeps & { ground?: Omit<GroundConfig, "retracted"> },
): Promise<GroundedResult | null> {
  const res = await summarizePaper(paper, opts, deps);
  if (!res) return null;

  // 取总结实际所依据的源文本
  let sourceText = (paper.abstract ?? "").trim();
  if (res.sourceBasis === "fulltext" && deps.fullText) {
    const ft = await deps.fullText.getFullText(paper, { signal: deps.signal }).catch(() => null);
    if (ft?.text) sourceText = ft.text;
  }

  const grounded = await buildGroundedSummary(res.text, sourceText, { ...(deps.ground ?? {}), retracted: paper.retracted });
  return { summaryText: res.text, sourceBasis: res.sourceBasis, model: res.model, grounded };
}
