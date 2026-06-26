// lumina-feed · M6 导出 · 汇总
import type { Paper } from "../model.ts";
import { toBibtexAll } from "./bibtex.ts";
import { toRisAll, toCslAll } from "./csl.ts";

export * from "./bibtex.ts";
export * from "./csl.ts";
export * from "./trends.ts";

export type ExportFormat = "bibtex" | "ris" | "csl-json";

export interface ExportResult { format: ExportFormat; ext: string; mime: string; content: string }

/** 统一导出：Paper[] → 指定格式的文本 + 文件元信息。 */
export function exportPapers(papers: Paper[], format: ExportFormat): ExportResult {
  switch (format) {
    case "bibtex": return { format, ext: "bib", mime: "application/x-bibtex", content: toBibtexAll(papers) };
    case "ris": return { format, ext: "ris", mime: "application/x-research-info-systems", content: toRisAll(papers) };
    case "csl-json": return { format, ext: "json", mime: "application/vnd.citationstyles.csl+json", content: toCslAll(papers) };
  }
}
