// lumina-feed · 证据可信性 · 可选 LLM 蕴含校验（ADR-T1：默认关；仅升级 weak 句）
// 约束校验器「只判断蕴含、不补充事实」；它**不能推翻**确定性的数字核验失败。
import type { LlmClient, LlmMessage } from "../summarize/types.ts";
import type { Claim } from "./grounding.ts";

export type Entailment = "supported" | "partial" | "unsupported";

export interface VerifyDeps {
  llm: LlmClient;
  signal?: AbortSignal;
  /** 仅校验这些状态的句子（默认只 weak，省成本、避免以幻验幻） */
  statuses?: Array<Claim["status"]>;
}

const SYS = [
  "你是严格的「蕴含判定器」。只判断：给定的【原文片段】是否支持【陈述】。",
  "只输出一个词：supported（片段明确支持陈述）/ partial（部分支持或不全）/ unsupported（片段不支持或无关）。",
  "不要补充任何信息，不要解释，不要纠正陈述，只输出那一个词。",
].join("\n");

function buildVerifyPrompt(claimText: string, span: string): LlmMessage[] {
  return [
    { role: "system", content: SYS },
    { role: "user", content: `【原文片段】\n${span}\n\n【陈述】\n${claimText}\n\n仅输出 supported / partial / unsupported 之一：` },
  ];
}

function parseEntailment(raw: string): Entailment {
  const s = raw.toLowerCase();
  if (s.includes("unsupported")) return "unsupported";
  if (s.includes("partial")) return "partial";
  if (s.includes("supported")) return "supported";
  return "partial";
}

export interface VerifiedClaim extends Claim { entailment?: Entailment }

/** 对 claims 做可选 LLM 蕴含校验。返回新数组（不可变）。 */
export async function verifyClaims(claims: Claim[], deps: VerifyDeps): Promise<VerifiedClaim[]> {
  const targetStatuses = new Set(deps.statuses ?? ["weak"]);
  const out: VerifiedClaim[] = [];
  for (const c of claims) {
    if (!targetStatuses.has(c.status) || !c.span?.quote) { out.push({ ...c }); continue; }
    let entailment: Entailment = "partial";
    try {
      const raw = await deps.llm.complete(buildVerifyPrompt(c.text, c.span.quote), { signal: deps.signal, temperature: 0 });
      entailment = parseEntailment(raw);
    } catch { entailment = "partial"; }

    // 升级/降级：蕴含 supported → grounded；unsupported → unsupported。
    // ADR-T1：数字核验失败 → 状态不得升到 grounded（校验器不能推翻确定性失败）。
    let status = c.status;
    if (entailment === "supported") status = c.numbersOk ? "grounded" : "weak";
    else if (entailment === "unsupported") status = "unsupported";
    out.push({ ...c, status, entailment });
  }
  return out;
}
