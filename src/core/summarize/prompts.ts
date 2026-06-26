// lumina-feed · Prompt 模板（tldr | structured | clinical | public）× 语言
// 贯穿护栏：只依据给定文本（反幻觉）；绝不输出纳入/排除建议（ADR-4）；
// 预印本标「未经同行评议」；撤稿标红；不歪曲。
import type { Paper } from "../model.ts";
import type { SummarizeOptions, LlmMessage } from "./types.ts";

/** reduce 阶段标记：fake/真实合并用同一约定 */
export const COMBINE_MARKER = "__LUMINA_COMBINE__";

const LANG: Record<SummarizeOptions["language"], string> = {
  zh: "用简体中文输出。",
  en: "Respond in English.",
  bilingual: "先输出简体中文，再输出英文（English），两段都给。",
};

function guardrails(p: Paper, basisIsFulltext: boolean): string {
  const lines = [
    "严格只依据下面提供的文本作答；任何文本中没有的事实都不要补充或臆测；信息不足就说明「原文未述」。",
    "不要给出是否「纳入/排除」此研究的建议或倾向——纳入与排除完全由研究者自行决定，这不是你的职责。",
    "不要编造数字、引用或结论；不要引用外部资料。",
    basisIsFulltext ? "以下为全文节选。" : "以下仅为标题与摘要（未获取全文）。",
  ];
  if (p.isPreprint) lines.push("这是预印本，未经同行评议——必须在结论处明确提示「未经同行评议，结论需谨慎」。");
  if (p.retracted) lines.push("该文献已被撤稿——必须在开头明确提示「已撤稿」。");
  return lines.join("\n");
}

function paperBlock(p: Paper, text: string): string {
  const meta = [
    `标题：${p.title}`,
    p.authors?.length ? `作者：${p.authors.slice(0, 8).join(", ")}` : "",
    [p.journal, p.year].filter(Boolean).join(" · ") ? `来源：${[p.journal, p.year].filter(Boolean).join(" · ")}` : "",
    p.isPreprint ? "类型：预印本（未经同行评议）" : "",
  ].filter(Boolean).join("\n");
  return `${meta}\n\n正文/摘要：\n${text}`;
}

const DEPTH_INSTRUCTION: Record<SummarizeOptions["depth"], string> = {
  tldr: "用一句话（不超过 60 字）概括这项研究最核心的发现。只给这一句，不要列表、不要前后缀。",
  structured:
    `输出**严格的 JSON**（不要 Markdown、不要代码围栏、不要多余文字），字段如下，缺失填 null：\n` +
    `{"purpose":"研究目的","methods":"方法/设计","results":"主要结果(含关键数据,若有)","conclusion":"结论","limitations":"局限","sampleSize":"样本量","studyType":"研究类型"}`,
  clinical:
    `输出**严格的 JSON**（不要 Markdown/代码围栏/多余文字），字段如下，缺失填 null：\n` +
    `{"purpose":"临床问题","methods":"研究设计","results":"关键结局与效应量","conclusion":"临床要点","limitations":"局限",` +
    `"sampleSize":"样本量","studyType":"研究类型","practiceChanging":"是否可能改变实践(仅作提示性判断,说明理由)","evidenceStrength":"证据强度(如:高/中/低,并说明依据)"}\n` +
    `注意：practiceChanging 与 evidenceStrength 仅为提示，不是对是否采纳的裁决。`,
  public:
    "用通俗语言（面向非专业读者）解释这项研究在做什么、发现了什么、为什么重要，3-5 句。不夸大、不歪曲；" +
    "若为预印本，结尾用一句话提醒「该研究尚未经过同行评议」。",
};

export interface PromptInput {
  paper: Paper;
  text: string;            // 摘要或全文(块)
  basisIsFulltext: boolean;
  opts: SummarizeOptions;
}

/** 构造单次（或单块）总结的消息 */
export function buildPrompt(input: PromptInput): LlmMessage[] {
  const { paper, text, basisIsFulltext, opts } = input;
  const system = [
    "你是严谨的科研文献总结助手。",
    guardrails(paper, basisIsFulltext),
    LANG[opts.language],
  ].join("\n");
  const user = [DEPTH_INSTRUCTION[opts.depth], "", paperBlock(paper, text)].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** 长全文分块后，reduce 合并多块要点为一份（结构化则合并为同一 JSON schema） */
export function buildCombinePrompt(paper: Paper, partials: string[], opts: SummarizeOptions): LlmMessage[] {
  const system = [
    "你在合并同一篇论文多个文本块的中间总结。",
    guardrails(paper, true),
    LANG[opts.language],
    COMBINE_MARKER,
  ].join("\n");
  const fmt = opts.depth === "structured" || opts.depth === "clinical"
    ? "把以下分块要点合并为**一个**符合前述字段的严格 JSON（不要 Markdown/围栏）。"
    : opts.depth === "tldr" ? "把以下分块要点合并为一句话（≤60 字）总括。"
    : "把以下分块要点合并为通俗的 3-5 句话说明。";
  const user = [fmt, "", ...partials.map((p, i) => `【块 ${i + 1}】${p}`)].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** 解析 structured/clinical 的 JSON 输出（容错：剥围栏 / 提取首个 {…}） */
export function parseStructured(raw: string): Record<string, unknown> | undefined {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  try { return JSON.parse(s); } catch { return undefined; }
}
