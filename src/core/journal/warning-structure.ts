// lumina-feed · 预警名单：粘贴官方文本 → LLM 结构化（只排版，不臆造）
// 诚实原则：LLM 仅把用户提供的权威文本整理成结构化条目，禁止新增/推断刊物，杜绝幻觉。
import type { LlmClient } from "../summarize/types.ts";
import type { WarningEntry } from "./types.ts";
import { normalizeIssn } from "./issn.ts";

const SYSTEM = [
  "你是严谨的数据整理助手。用户会粘贴一段权威文本（通常是中科院文献情报中心《国际期刊预警名单》官方内容）。",
  "你的唯一任务：把文本中【确实出现】的期刊整理成 JSON 数组。",
  "绝对禁止：新增、补全、推断或臆造任何未在文本中出现的期刊、ISSN、原因或年份。文本没有的字段就省略。",
  "字段规范：",
  "  title  期刊英文全称（必填，保持原文大小写）",
  "  issn   形如 1234-5678（仅当文本给出时；不确定就省略）",
  "  reason 预警原因（如「论文工厂」，仅当文本给出时）",
  "  year   年度数字（如 2025，仅当文本明确时）",
  "只输出 JSON 数组本身，不要 markdown 代码围栏、不要任何解释或前后缀。",
  '示例：[{"title":"Some Journal","issn":"1234-5678","reason":"论文工厂","year":2025}]',
].join("\n");

function stripFences(s: string): string {
  let t = String(s || "").trim();
  // 去掉 ```json ... ``` 或 ``` ... ```
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) t = m[1].trim();
  // 截取第一个 [ 到最后一个 ]
  const a = t.indexOf("[");
  const b = t.lastIndexOf("]");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t;
}

/** 调用 LLM 将粘贴文本结构化为预警条目（清洗后返回；不落盘） */
export async function structureWarningEntries(text: string, llm: LlmClient): Promise<WarningEntry[]> {
  const out = await llm.complete(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: "以下是待整理的官方文本：\n\n" + String(text || "").slice(0, 20000) },
    ],
    { temperature: 0, maxTokens: 4000 },
  );
  let parsed: unknown;
  try { parsed = JSON.parse(stripFences(out)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const entries: WarningEntry[] = [];
  const seen = new Set<string>();
  for (const it of parsed) {
    if (!it || typeof it !== "object") continue;
    const title = String((it as any).title || (it as any).journal || "").trim();
    if (!title) continue;
    const issn = normalizeIssn((it as any).issn) || undefined;
    const key = issn ? issn.replace("-", "") : "t:" + title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const yearNum = Number((it as any).year);
    entries.push({
      title,
      issn,
      reason: (it as any).reason ? String((it as any).reason).trim() : undefined,
      year: Number.isFinite(yearNum) && yearNum > 1900 && yearNum < 3000 ? yearNum : undefined,
    });
  }
  return entries;
}
