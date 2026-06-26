// lumina-feed · 证据可信性 · 编排 GroundedSummary
// ground（确定性永远跑）→ 可选 LLM 校验 → 比例 + 横幅 + 标注（暴露不改写）+ 撤稿前置。
import { groundSummary, type Claim, type GroundingOptions } from "./grounding.ts";
import { verifyClaims, type VerifyDeps, type VerifiedClaim } from "./verifier.ts";

export interface GroundedSummary {
  text: string;                 // 原总结（不改写）
  claims: VerifiedClaim[];
  groundedRatio: number;        // grounded 句 / 总句
  flagged: VerifiedClaim[];     // unsupported 或 数字存疑
  retractedWarning: boolean;
  banner?: string;              // 整体警示（低 grounding / 撤稿）
  annotated: string;            // 标注版（不支持/存疑句保留原样 + 显眼标记）
}

export interface GroundConfig extends GroundingOptions {
  /** grounded 比例低于此 → 打整体警示横幅（默认 0.5） */
  bannerThreshold?: number;
  retracted?: boolean;          // 来自 M1 paper.retracted
  /** 提供则做可选 LLM 蕴含校验（默认不做） */
  verify?: VerifyDeps;
}

const MARK_UNSUP = "⚠未在原文找到依据";
const MARK_NUM = "⚠数字存疑";

/** 标注：不改写句子，只在「不支持 / 数字存疑」句尾追加显眼标记。 */
export function annotate(claims: Claim[]): string {
  return claims.map((c) => {
    const marks: string[] = [];
    if (c.status === "unsupported") marks.push(MARK_UNSUP);
    if (!c.numbersOk) marks.push(`${MARK_NUM}(${c.missingNumbers.join(",")})`);
    return marks.length ? `${c.text} 〔${marks.join(" · ")}〕` : c.text;
  }).join(" ");
}

export async function buildGroundedSummary(summary: string, source: string, cfg: GroundConfig = {}): Promise<GroundedSummary> {
  let claims: VerifiedClaim[] = groundSummary(summary, source, cfg);
  if (cfg.verify) claims = await verifyClaims(claims, cfg.verify);

  const total = claims.length || 1;
  const grounded = claims.filter((c) => c.status === "grounded").length;
  const groundedRatio = Math.round((grounded / total) * 100) / 100;
  const flagged = claims.filter((c) => c.status === "unsupported" || !c.numbersOk);
  const retractedWarning = !!cfg.retracted;

  const bannerThreshold = cfg.bannerThreshold ?? 0.5;
  let banner: string | undefined;
  if (retractedWarning) banner = "⛔ 该文献已撤稿/更正——总结仅供识别，勿作为证据";
  else if (groundedRatio < bannerThreshold) banner = `⚠ 低 grounding（${grounded}/${total} 句有原文依据）——请核对原文`;
  else if (flagged.length) banner = `⚠ ${flagged.length} 处需核对（见标记）`;

  return { text: summary, claims, groundedRatio, flagged, retractedWarning, banner, annotated: annotate(claims) };
}
