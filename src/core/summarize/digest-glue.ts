// lumina-feed · 把总结接进每日简报
// 为每条命中生成 TL;DR（卡片一句话），填上 M1 的 paperToDigestItem 留空的 tldr / sourceBasis。
// ADR-4：只填总结字段，绝不写 screening；纳入/排除永远人工。
import type { Paper } from "../model.ts";
import type { DigestItem } from "../schedule/types.ts";
import type { SummarizeOptions } from "./types.ts";
import { summarizePaper, type SummarizeDeps } from "./summarizer.ts";

/** 给一批 DigestItem 补 tldr + sourceBasis（按订阅的 source/fetchPdf/language，但深度固定 tldr 用于卡片）。 */
export async function enrichDigestItems(
  items: DigestItem[],
  getPaper: (id: string) => Paper | undefined | Promise<Paper | undefined>,
  opts: SummarizeOptions,
  deps: SummarizeDeps,
): Promise<DigestItem[]> {
  if (opts.source === "none") return items; // 不总结
  const tldrOpts: SummarizeOptions = { ...opts, depth: "tldr", scope: "digest_hits" };
  for (const it of items) {
    const paper = await getPaper(it.id);
    if (!paper) continue;
    try {
      const res = await summarizePaper(paper, tldrOpts, deps);
      if (res) { it.tldr = res.text; it.sourceBasis = res.sourceBasis; }
    } catch { /* 单条失败不拖垮整份；该条无 tldr 即可 */ }
  }
  return items;
}
