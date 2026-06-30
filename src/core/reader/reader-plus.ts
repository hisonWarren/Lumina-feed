// lumina-feed · 阅读器扩展分析（reader_plus 地基）
// 统一输出信封 AnalysisEnvelope：lane 是契约字段——渲染层只按 lane 路由（证据/推断/拒绝），
// 杜绝"把推断洗成接地"（需求共议生死线）。复用 reader-ai 页锚与不杜撰纪律：只单篇、带页码、不杜撰。
import type { LlmClient } from "../summarize/types.ts";
import { chunkByPages, type ReaderPage } from "./reader-ai.ts";

export type Lane = "evidence" | "inference";
export type Groundability = "L0" | "L1" | "L2" | "L3";
export type EvidenceType = "internal_data" | "cites_others" | "author_inference";
export type Confidence = "c1" | "c2" | "c3"; // 文中有据 / 需外部佐证 / 单篇无法确证

export interface AnalysisClaim {
  text: string;
  pageRefs: number[];
  evidenceType?: EvidenceType;
  confidence?: Confidence;
  flag?: "needs_recheck" | "unstated";
  status?: "ok" | "warn" | "no"; // 可复现性清单：已报告/缺失/未做
  paperRefs?: string[]; // 跨篇分析：本条结论涉及/来源的文献（标题），非页码
  paperRefIds?: string[]; // 跨篇分析：文献 id（与 paperRefs 同序，供 UI 跳转阅读器）
  groundedRatio?: number;
}
export type CorpusInputTier = "structured" | "summary" | "abstract" | "fulltext_excerpt" | "none";
export type CorpusDepth = "structured" | "fulltext_excerpt";
export interface CorpusCoverage {
  total: number;
  structured: number;
  summary: number;
  abstract: number;
  fulltext: number;
  none: number;
  depth: CorpusDepth;
  papers: { id: string; title: string; tier: CorpusInputTier }[];
}
export interface AnalysisEnvelope {
  kind: string;
  lane: Lane;                 // 渲染层唯一据此路由（HC-1）
  groundability: Groundability;
  sourceBasis: "fulltext" | "fulltext+vision" | "external" | "corpus";
  model: string;
  title: string;
  framing?: string;           // 强制框定语（如 CARS：论证逻辑重建≠真实思考过程）
  banner?: string;
  refused?: { reason: string }; // L3 拒绝块
  graph?: { nodes: { id: string; label: string; pageRefs: number[] }[]; edges: { from: string; to: string; label?: string }[] }; // 逻辑流程图：节点（带页码）+ 边（AI 解读的依赖）；见 flowmap
  claims: AnalysisClaim[];
  practice?: boolean;         // 是否走练判断 gate
  speculative?: boolean;      // genesis opt-in 推测
  coverage?: CorpusCoverage;  // 跨篇：各篇输入来源覆盖度
}

export interface KindSpec { lane: Lane; groundability: Groundability; title: string; framing?: string; practice?: boolean }

// 单一车道真相源（HC-1）：渲染层与 verify 都据此；后续新增分析器须在此登记 lane。
export const KIND_REGISTRY: Record<string, KindSpec> = {
  outline:     { lane: "evidence",  groundability: "L0", title: "逻辑大纲" },
  cars:        { lane: "evidence",  groundability: "L1", title: "作者论证逻辑（CARS）", framing: "这是对作者论证逻辑（为何这样选题/设计）的重建，依据正文；这不是作者真实的思考过程，后者无法从已发表论文中恢复。" },
  ledger:      { lane: "evidence",  groundability: "L1", title: "claim–证据账本" },
  recipe:      { lane: "evidence",  groundability: "L0", title: "方法配方（可复用）" },
  repro:       { lane: "evidence",  groundability: "L0", title: "可复现性清单" },
  falsify:     { lane: "evidence",  groundability: "L0", title: "可证伪边界（Popper）" },
  citerole:    { lane: "evidence",  groundability: "L1", title: "引文角色" },
  move:        { lane: "evidence",  groundability: "L1", title: "写作观察" },
  hardcore:    { lane: "inference", groundability: "L1", title: "硬核 / 保护带分解", framing: "这是 AI 基于研究纲领方法论（Lakatos）的推断分层，作者并未如此区分。" },
  limitations: { lane: "inference", groundability: "L2", title: "作者未言明的局限", practice: true },
  genesis:     { lane: "inference", groundability: "L3", title: "作者真实的发现过程" },
  figure:      { lane: "inference", groundability: "L2", title: "图表分析" },
  corpus_framing:       { lane: "inference", groundability: "L2", title: "主流框定地图" },
  corpus_contradiction: { lane: "inference", groundability: "L2", title: "矛盾发现" },
  corpus_recipe:        { lane: "evidence",  groundability: "L1", title: "方法配方汇编" },
  corpus_timeline:      { lane: "inference", groundability: "L2", title: "观点演进时间线" },
  corpus_gaps:          { lane: "inference", groundability: "L2", title: "证据空白地图" },
  stats:       { lane: "inference", groundability: "L2", title: "统计一致性扫描", framing: "这是 AI 对可能的统计报告不一致的提示，不是判定出错；AI 无法可靠核验算术，每条都需你手动复核，或用 statcheck / GRIM 等工具做确定性重算。" },
  flowmap:     { lane: "inference", groundability: "L2", title: "方法 / 逻辑流程图", framing: "这是 AI 从正文方法/流程描述重建的流程图（推断车道）：每个节点标注页码、点击可回原文核对；箭头是 AI 解读的步骤依赖，非原文断言。无页码依据的节点已标灰，请谨慎采信。" },
};

const ZH_TEXT_RULE = "用简体中文写每条 text（一句概括）；若原文关键术语、引文、数值为英文，在中文后用括号保留原文（如「内感受（interoception）」）。";
const SYS = "你是严谨的科研阅读助手。只依据用户提供的逐页正文作答，不杜撰数字与引用。" + ZH_TEXT_RULE + "每个条目都要给出其依据的页码（整数数组）。仅输出 JSON 对象，不要任何解释、不要 Markdown 代码围栏。";

// 字符串/转义安全地扫出某个 '[' 之后、该数组内所有「完整的顶层 {…} 对象」子串。
// 用于截断救援：长列表（ledger/citerole）常被 maxTokens 截断，导致整段 JSON.parse 失败 → 旧版静默空卡。
// 这里逐字符走括号深度（跳过字符串与转义），收集到的最后一个完整对象之前的内容仍可用，只丢被截断的尾巴。
function salvageObjects(s: string, fromBracket: number): string[] {
  const out: string[] = [];
  let i = fromBracket + 1, depth = 0, start = -1, inStr = false, esc = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "\"") inStr = false; continue; }
    if (ch === "\"") { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; } }
    else if (ch === "]" && depth === 0) break; // 数组正常收尾
  }
  return out;
}
// 救援指定键的数组（claims / nodes / edges / outline / sections…）：先找 "key"…[，再 salvageObjects，逐个尝试 JSON.parse（丢弃坏的那个）。
const SALVAGE_ARRAY_KEYS = ["claims", "outline", "sections", "items", "steps", "structure", "entries", "nodes", "edges"];
function salvageArray(s: string, key: string): any[] | null {
  const re = new RegExp("\"" + key + "\"\\s*:\\s*\\[");
  const m = re.exec(s);
  if (!m) return null;
  const objs = salvageObjects(s, m.index + m[0].length - 1);
  const parsed: any[] = [];
  for (const o of objs) { try { parsed.push(JSON.parse(o)); } catch { /* 丢弃被截断的元素 */ } }
  return parsed.length ? parsed : null;
}

// 从模型回复里稳健抽取 JSON（取第一个花括号到最后一个花括号；不依赖代码围栏，避免源码内裸引号）。
// 截断救援：直接 parse 失败时，按已知数组键逐个救援完整元素，重建对象——把「被截断 → 静默空」变为「尽量保住已生成的条目」。
function extractJson(raw: string): any {
  const s = String(raw || "");
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch { /* 进入救援 */ } }
  for (const key of SALVAGE_ARRAY_KEYS) {
    const arr = salvageArray(s, key);
    if (arr) {
      if (key === "nodes" || key === "edges") {
        const nodes = key === "nodes" ? arr : salvageArray(s, "nodes");
        const edges = key === "edges" ? arr : salvageArray(s, "edges");
        return { nodes: nodes || [], edges: edges || [] };
      }
      return { [key === "outline" || key === "sections" || key === "items" || key === "steps" || key === "structure" || key === "entries" ? key : "claims"]: arr };
    }
  }
  return null;
}

const CLAIM_ARRAY_KEYS = ["claims", "outline", "sections", "items", "steps", "structure", "entries"];
const CLAIM_TEXT_KEYS = ["text", "content", "label", "title", "claim", "summary", "body", "description", "point"];
const PAGE_REF_KEYS = ["pageRefs", "pages", "page_refs", "refs", "pageNumbers"];

function pickClaimsArray(parsed: any): any[] | null {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object") return null;
  for (const k of CLAIM_ARRAY_KEYS) {
    if (Array.isArray(parsed[k])) return parsed[k];
  }
  return null;
}

function claimText(c: any): string {
  if (c == null) return "";
  if (typeof c === "string") return c.trim();
  if (typeof c !== "object") return String(c).trim();
  for (const k of CLAIM_TEXT_KEYS) {
    const t = String(c[k] ?? "").trim();
    if (t) return t;
  }
  return "";
}

function claimPageRefs(c: any, valid: Set<number>): number[] {
  if (!c || typeof c !== "object") return [];
  let raw: any = null;
  for (const k of PAGE_REF_KEYS) {
    if (c[k] != null) { raw = c[k]; break; }
  }
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: number[] = [];
  for (const n of arr) {
    const p = parseInt(String(n).replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(p) && valid.has(p)) out.push(p);
  }
  return [...new Set(out)];
}

function mapClaimsFromArray(arr: any[], kind: string, spec: KindSpec, valid: Set<number>): AnalysisClaim[] {
  return arr.map((c: any) => {
    const refs = claimPageRefs(c, valid);
    const claim: AnalysisClaim = { text: claimText(c), pageRefs: refs };
    if (c && c.evidenceType) claim.evidenceType = c.evidenceType;
    if (c && c.confidence) claim.confidence = c.confidence;
    if (c && c.flag) claim.flag = c.flag;
    if (c && c.status) claim.status = c.status;
    if (!claim.confidence && spec.lane === "inference") claim.confidence = spec.groundability === "L2" ? "c2" : spec.groundability === "L3" ? "c3" : "c1";
    if (kind === "stats") { claim.confidence = "c3"; claim.flag = "needs_recheck"; }
    return claim;
  }).filter((c: AnalysisClaim) => c.text.length > 0);
}

function assertStructuredClaims(kind: string, raw: string, parsed: any, claims: AnalysisClaim[]): void {
  const rawTrim = String(raw || "").trim();
  if (!rawTrim) {
    throw new Error("模型未返回任何内容。若使用 DeepSeek V4，请更新到最新版本；或在「设置 → 大模型」关闭思考模式/更换模型后重试。");
  }
  if (parsed == null) {
    throw new Error("模型输出无法解析为结构化 JSON（可能返回了 Markdown 或说明文字）。请重试，或在「设置 → 大模型」换用更强模型。");
  }
  const arr = pickClaimsArray(parsed);
  if (arr == null) {
    const keys = typeof parsed === "object" && parsed ? Object.keys(parsed).slice(0, 8).join("、") : "";
    throw new Error("模型 JSON 缺少 claims/outline/sections 等条目数组（检测到字段：" + (keys || "无") + "）。请重试或更换模型。");
  }
  if (arr.length === 0) {
    throw new Error("模型返回了空条目列表。请重试；若反复出现，请换更强的模型或在设置中检查 API 配置。");
  }
  if (claims.length === 0) {
    throw new Error("模型返回了 " + arr.length + " 条结构，但均无有效文本（字段名可能不符）。请重试或更换模型。");
  }
}

// 默认逐页拼接（前部优先）；短文档单次过，长文档走 map-reduce 覆盖全篇。
function pagesText(pages: ReaderPage[], cap = 24000): string {
  let out = "";
  for (const p of pages) { out += `[p.${p.page}] ${p.text}\n\n`; if (out.length > cap) break; }
  return out;
}
function pagesTextLen(pages: ReaderPage[]): number {
  let n = 0;
  for (const p of pages) n += `[p.${p.page}] ${p.text}\n\n`.length;
  return n;
}
// 每个 kind 的输入取材上限与输出 token 预算（最佳体验：列表型分析器给足额度；超长走 map-reduce 而非截断）。
const INPUT_CAP: Record<string, number> = { ledger: 36000, recipe: 32000, repro: 32000, cars: 28000 };
const OUTPUT_MAXTOK: Record<string, number> = { ledger: 4000, citerole: 3600, recipe: 2800, repro: 2800, cars: 2200, falsify: 2200, outline: 2200, hardcore: 2200, limitations: 2200, stats: 2400, flowmap: 1800 };
const MR_CHUNK = 10000;
const MR_MAX_CHUNKS = 16;
const MAP_CHUNK_SUFFIX = "\n\n【分段说明】以下仅是论文连续片段之一；只抽取本片段中出现的条目，页码必须用片段内 [p.N] 的真实页码。不要编造、不要重复其他片段会有内容。";
const LEDGER_CHUNK_SUFFIX = "\n\n【分段说明】以下仅是论文连续片段之一。列出本片段内 3–8 条候选「论断→证据」对（承重主张，跳过琐碎背景句）：text 用「论断：…；证据：…」格式（各一句）。这些是分段要点、后续会归并，不要合并成宏观主题摘要，也不要逐句穷举。页码必须用片段内 [p.N]。不要编造、不要重复其他片段内容。";
/** 账本承重论断硬上限：侧边栏可浏览、可核对，而非穷举全文每句。 */
export const LEDGER_MAX_CLAIMS = 40;
/** 候选条数超过此值时触发 LLM 归并（map→reduce）。 */
export const LEDGER_REDUCE_THRESHOLD = 16;
/** 引文角色硬上限（A1+）：只列正文讨论过的 in-text 引用，防滑向完整书目。 */
export const CITEROLE_MAX_CLAIMS = 20;
const MAP_REDUCE_KINDS = new Set(["cars", "ledger", "recipe", "repro", "falsify", "citerole", "hardcore", "limitations", "stats", "outline"]);

function bodyFor(kind: string, pages: ReaderPage[]): string {
  return pagesText(pages, INPUT_CAP[kind] ?? 26000);
}

function needsMapReduce(kind: string, pages: ReaderPage[]): boolean {
  if (!MAP_REDUCE_KINDS.has(kind)) return false;
  const len = pagesTextLen(pages);
  if (pages.length <= 2 && len <= 14000) return false;
  // 最佳体验：≥4 页或正文偏长时分段扫描全篇，避免只读前几页引言
  return len > 14000 || pages.length >= 4;
}

function coverageBanner(pages: ReaderPage[], chunks: number, hits?: number): string {
  const base = `已分段扫描全文 ${pages.length} 页（${chunks} 段）`;
  if (hits != null && hits < chunks) return `${base} · ${hits}/${chunks} 段抽出条目`;
  return base;
}

function mapChunkSuffix(kind: string): string {
  return kind === "ledger" ? LEDGER_CHUNK_SUFFIX : MAP_CHUNK_SUFFIX;
}

function mapChunkMaxTokens(kind: string): number {
  if (kind === "ledger") return 3600;
  if (kind === "citerole") return 3200;
  return Math.min(OUTPUT_MAXTOK[kind] ?? 1600, 2200);
}

function ledgerDedupeKey(c: AnalysisClaim): string {
  const norm = c.text.replace(/\s+/g, " ").trim().toLowerCase();
  const claimPart = norm.includes("论断：")
    ? norm.split("证据：")[0].replace(/^论断：/, "").trim()
    : norm;
  return `${c.pageRefs?.[0] ?? 0}:${claimPart.slice(0, 88)}`;
}

function dedupeClaims(claims: AnalysisClaim[], kind?: string): AnalysisClaim[] {
  const seen = new Set<string>();
  const out: AnalysisClaim[] = [];
  for (const c of claims) {
    const key = kind === "ledger" ? ledgerDedupeKey(c) : c.text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function reduceLedgerClaims(
  rawClaims: AnalysisClaim[],
  spec: KindSpec,
  llm: LlmClient,
  valid: Set<number>,
  opts: { signal?: AbortSignal } = {},
): Promise<AnalysisClaim[]> {
  const limit = LEDGER_MAX_CLAIMS;
  const lines = rawClaims.map((c, i) => {
    const pg = (c.pageRefs || []).join(",");
    return `[#${i + 1}] p.${pg || "?"} type=${c.evidenceType || ""} ${c.text}`;
  }).join("\n");
  const instruction =
    `以下是全文分段扫描抽出的 ${rawClaims.length} 条候选「论断→证据」要点。请归并为最多 ${limit} 条承重论断：`
    + "合并语义重复或同一主张的变体；删掉琐碎背景、与论证承重无关的复述；保留对理解本文论证最关键者。"
    + "每条 text 保持「论断：…；证据：…」格式；保留 evidenceType（internal_data/cites_others/author_inference）；"
    + "pageRefs 取自候选中的真实页码（可合并多条页码）。不要杜撰正文没有的内容。"
    + ZH_TEXT_RULE
    + "输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text、evidenceType、pageRefs（整数数组）；"
    + "当 evidenceType 为 author_inference 时再加字段 flag 取值 needs_recheck。只输出该 JSON。";
  const raw = await llm.complete(
    [{ role: "system", content: SYS }, { role: "user", content: instruction + "\n\n候选列表：\n" + lines }],
    { maxTokens: 4800, temperature: 0.15, signal: opts.signal },
  );
  const parsed = extractJson(raw);
  const arr = pickClaimsArray(parsed) || [];
  let claims = sortClaimsByPage(dedupeClaims(mapClaimsFromArray(arr, "ledger", spec, valid), "ledger"));
  if (!claims.length) {
    return sortClaimsByPage(rawClaims).slice(0, limit);
  }
  if (claims.length > limit) claims = claims.slice(0, limit);
  return claims;
}

async function finalizeLedgerClaims(
  claims: AnalysisClaim[],
  pages: ReaderPage[],
  spec: KindSpec,
  llm: LlmClient,
  valid: Set<number>,
  banner: string | undefined,
  opts: { signal?: AbortSignal } = {},
): Promise<{ claims: AnalysisClaim[]; banner?: string }> {
  const mappedCount = claims.length;
  if (mappedCount <= LEDGER_REDUCE_THRESHOLD) {
    const capped = mappedCount > LEDGER_MAX_CLAIMS ? claims.slice(0, LEDGER_MAX_CLAIMS) : claims;
    return { claims: capped, banner };
  }
  try {
    const reduced = await reduceLedgerClaims(claims, spec, llm, valid, opts);
    const base = banner || (pages.length > 1 ? `已扫描全文 ${pages.length} 页` : undefined);
    return {
      claims: reduced,
      banner: base ? `${base} · 候选 ${mappedCount} 条 → 归并 ${reduced.length} 条承重论断` : `候选 ${mappedCount} 条 → 归并 ${reduced.length} 条承重论断`,
    };
  } catch {
    const fallback = sortClaimsByPage(claims).slice(0, LEDGER_MAX_CLAIMS);
    const base = banner || (pages.length > 1 ? `已扫描全文 ${pages.length} 页` : undefined);
    return {
      claims: fallback,
      banner: base ? `${base} · 归并未成功，已保留前 ${fallback.length} 条` : `归并未成功，已保留前 ${fallback.length} 条`,
    };
  }
}

function sortClaimsByPage(claims: AnalysisClaim[]): AnalysisClaim[] {
  return claims.slice().sort((a, b) => {
    const pa = a.pageRefs?.[0] ?? 9999;
    const pb = b.pageRefs?.[0] ?? 9999;
    return pa - pb || a.text.localeCompare(b.text);
  });
}

async function mapStructuredChunk(
  kind: string,
  chunkPages: ReaderPage[],
  instruction: string,
  llm: LlmClient,
  opts: { signal?: AbortSignal } = {},
): Promise<any[]> {
  const body = chunkPages.map((p) => `[p.${p.page}] ${p.text}`).join("\n\n");
  const raw = await llm.complete(
    [{ role: "system", content: SYS }, { role: "user", content: instruction + mapChunkSuffix(kind) + "\n\n正文片段：\n" + body }],
    { maxTokens: mapChunkMaxTokens(kind), temperature: 0.2, signal: opts.signal },
  );
  const parsed = extractJson(raw);
  return pickClaimsArray(parsed) || [];
}

async function runStructuredMapReduce(
  kind: string,
  pages: ReaderPage[],
  spec: KindSpec,
  llm: LlmClient,
  opts: { signal?: AbortSignal } = {},
): Promise<AnalysisEnvelope> {
  const instruction = PROMPTS[kind];
  if (!instruction) throw new Error("analyzeReader: kind 尚未在本版本实现：" + kind);
  const valid = new Set<number>(pages.map((p) => p.page));
  const chunks = chunkByPages(pages, MR_CHUNK, MR_MAX_CHUNKS);
  const mapped = await Promise.all(chunks.map((c) => mapStructuredChunk(kind, c, instruction, llm, opts).catch(() => [])));
  const hitChunks = mapped.filter((arr) => arr.length > 0).length;
  const flat = mapped.flat();
  if (!flat.length) {
    throw new Error("分段扫描未抽出任何条目。请重试，或在「设置 → 大模型」换用更强模型。");
  }
  let claims = sortClaimsByPage(dedupeClaims(mapClaimsFromArray(flat, kind, spec, valid), kind));
  if (!claims.length) {
    throw new Error("分段扫描返回了结构，但均无有效文本。请重试或更换模型。");
  }
  let banner = coverageBanner(pages, chunks.length, hitChunks);
  if (kind === "ledger") {
    const fin = await finalizeLedgerClaims(claims, pages, spec, llm, valid, banner, opts);
    claims = fin.claims;
    banner = fin.banner;
  } else if (kind === "citerole" && claims.length > CITEROLE_MAX_CLAIMS) {
    claims = claims.slice(0, CITEROLE_MAX_CLAIMS);
  }
  return {
    kind,
    lane: spec.lane,
    groundability: spec.groundability,
    sourceBasis: "fulltext",
    model: llm.model,
    title: spec.title,
    framing: spec.framing,
    banner,
    claims,
  };
}

// 每个 kind 的指令（用 JSON 形状的"文字描述"而非字面 JSON，避免源码内裸引号；模型仍只输出 JSON）。
const PROMPTS: Record<string, string> = {
  cars: "重建作者论证逻辑（CARS 五步：① 确立领域重要性 → ② 指出研究空白 → ③ 提出占位即本研究如何填补 → ④ 方法选择的论证 → ⑤ 贡献声明），依据 Introduction 与相关工作。" + ZH_TEXT_RULE + "输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text（一步，可带「① 确立领域重要性」前缀）与 pageRefs（页码整数数组）。只输出该 JSON。",
  ledger: "通读全文，列出承重论断及其证据（含引言、方法、结果、讨论、结论各节；不要只列前几页背景，也不要整篇只给 2–3 条主题概括）。" + ZH_TEXT_RULE + "每条 text 必须用「论断：…；证据：…」格式（各一句：论断是作者主张什么，证据是数据/引用/推理依据）。优先承重主张，跳过琐碎背景句；长文分段扫描后会归并为最多约 40 条，此处勿穷举每句。对每条标注 evidenceType，取值为 internal_data（本研究内部数据）、cites_others（引用他人，非本研究证明）、author_inference（作者推断，非直接实验之一）。输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text、evidenceType、pageRefs（页码整数数组）；当 evidenceType 为 author_inference 时再加字段 flag 取值 needs_recheck。只输出该 JSON。",
  recipe: "抽取可复用的方法配方，分为：设计、数据与队列、结局定义、验证或测量指标、统计方法。" + ZH_TEXT_RULE + "输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text（可带「设计：」这类前缀）与 pageRefs（页码整数数组）。只输出该 JSON。",
  repro: "对照预测模型/临床研究报告规范（TRIPOD、CONSORT、PRISMA 思路），逐项核查本文是否报告了：样本量与时间窗、结局定义、缺失数据处理、数据可得性声明、代码或模型可得性、研究预注册等。" + ZH_TEXT_RULE + "对每项给字段 status，取值为 ok（已报告）、warn（缺失或未见声明）、no（明确未做）。输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text、status、pageRefs（status 非 ok 且文中无对应位置时 pageRefs 可为空数组）。不要把未报告的项说成已报告。只输出该 JSON。",
  falsify: "抽取作者自陈的可证伪边界：什么观察会推翻其结论、或在什么条件下结论不成立。" + ZH_TEXT_RULE + "若作者未给出明确的可证伪条件，则输出一条 text 说明未陈述可证伪条件、并加字段 flag 取值 unstated——这本身是一个值得注意的发现。输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text、pageRefs（页码整数数组）与可选的 flag。只输出该 JSON。",
  citerole: "通读全文，只解释正文里被讨论到的关键引用各起什么作用。角色类别如：背景支撑、方法来源、对比或张力、数据来源、结果佐证。" + ZH_TEXT_RULE + "每条必须能在正文找到该引用被使用的上下文；参考文献表里有但正文未讨论的条目不要输出。尽量覆盖正文各处的重要引用簇（不只前几页）。claims 数组最多 20 条；若重要引用超过 20，优先保留对论证结构最关键者。输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text（形如「[12,13]：背景支撑，用于确立……」）与 pageRefs（该引用出现处的页码整数数组）。只输出该 JSON。",
  hardcore: "把本研究依赖的假设分为两层：硬核（被否证则整篇结论要重做的承重假设）与保护带（可调整而不动核心的辅助假设）。这是基于研究纲领方法论（Lakatos）的推断分层，作者通常并不如此区分。" + ZH_TEXT_RULE + "输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text（可带「硬核 H1：」或「保护带 P1：」前缀）与 pageRefs（若文中有据，整数数组，可为空）。只输出该 JSON。",
  limitations: "指出作者未明确陈述、但从其方法与数据可合理推断的潜在局限；每条都应能与正文方法交叉核对。这是 AI 的推测、需外部佐证、可能误判。" + ZH_TEXT_RULE + "输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text 与 pageRefs（若与某页方法相关，整数数组，可为空）。只输出该 JSON。",
  stats: "扫描全文统计报告，找出看起来可能不一致、值得复核的地方，例如：报告的 p 值与检验统计量及自由度看起来对不上、百分比与分子分母或样本量看起来对不上、置信区间与 p 值的显著性方向看起来矛盾、自由度与样本量看起来不一致、数字四舍五入后看起来不自洽等。这只是提示、不是判定出错：你无法可靠核验算术，每条都必须表述为「看起来……建议复核」，并提醒用户手动重算或用 statcheck/GRIM 等工具确认。不要断言任何数字是错的，不要编造文中没有的数字。" + ZH_TEXT_RULE + "输出一个 JSON 对象，含字段 claims（数组）；每个元素含 text、pageRefs（页码整数数组）、confidence 取值 c3、flag 取值 needs_recheck。只输出该 JSON。",
  outline: "提取这篇论文的逻辑大纲（如：背景 → 研究空白 → 研究问题 → 方法 → 结果 → 讨论/局限 → 结论）。逻辑结构来自正文章节标题与主题句。" + ZH_TEXT_RULE + "输出一个 JSON 对象，含字段 claims（数组）；claims 的每个元素含两个字段：text（一句话条目，可带「背景：」这类前缀）与 pageRefs（该条依据的页码，整数数组）。只输出该 JSON 对象。",
  flowmap: "把这篇论文的研究/方法逻辑抽成一张有向流程图，严格按正文真实描述的步骤与先后依赖来组织——可能是线性流水线，也可能有分支、并行或回路；只画正文写明的环节，不要补充论文未描述的步骤。节点 label 用简体中文（≤10 字），必要时括号保留英文缩写。输出一个 JSON 对象，含两个字段：nodes（数组，每个元素含 id 短字符串、label 步骤简称、pageRefs 该步骤依据的页码整数数组）与 edges（数组，每个元素含 from 与 to 为节点 id、可选 label 关系简述不超过 6 个中文字）。节点数控制在 5 到 10 个，分支与汇合用多条边表达。只输出该 JSON。",
};

async function runStructured(kind: string, pages: ReaderPage[], spec: KindSpec, llm: LlmClient, opts: { signal?: AbortSignal } = {}): Promise<AnalysisEnvelope> {
  if (needsMapReduce(kind, pages)) {
    return runStructuredMapReduce(kind, pages, spec, llm, opts);
  }
  const instruction = PROMPTS[kind];
  if (!instruction) throw new Error("analyzeReader: kind 尚未在本版本实现：" + kind);
  const valid = new Set<number>(pages.map((p) => p.page));
  const raw = await llm.complete(
    [ { role: "system", content: SYS }, { role: "user", content: instruction + "\n\n正文：\n" + bodyFor(kind, pages) } ],
    { maxTokens: OUTPUT_MAXTOK[kind] ?? 1400, temperature: 0.2, signal: opts.signal },
  );
  const parsed = extractJson(raw);
  const arr = pickClaimsArray(parsed) || [];
  const claims = mapClaimsFromArray(arr, kind, spec, valid);
  assertStructuredClaims(kind, raw, parsed, claims);
  let outClaims = claims;
  let banner = pages.length > 1 ? `已扫描全文 ${pages.length} 页` : undefined;
  if (kind === "ledger") {
    const fin = await finalizeLedgerClaims(outClaims, pages, spec, llm, valid, banner, opts);
    outClaims = fin.claims;
    banner = fin.banner;
  } else if (kind === "citerole" && outClaims.length > CITEROLE_MAX_CLAIMS) {
    outClaims = outClaims.slice(0, CITEROLE_MAX_CLAIMS);
  }
  return { kind, lane: spec.lane, groundability: spec.groundability, sourceBasis: "fulltext", model: llm.model, title: spec.title, framing: spec.framing, banner, claims: outClaims };
}

const SYS_MOVE = "你分析学术写作的修辞功能。只就给定句子说明它在做什么修辞动作（如铺垫/让步/转折/反驳/收束/重申），以及在什么情境下适合这样写；不要给可照抄的句式模板，不要改写或仿写该句。仅输出 JSON 对象，含字段 function（这句在做什么修辞动作）与 condition（什么情境下适合这样写），不要解释、不要代码围栏。";

// 写作观察：就"选中的真实句子"标注修辞功能 + 情境。原句逐字保留（不经模型改写，杜绝杜撰/洗稿）；带防抄袭 + 接 humanization 框定语。
async function runMove(text: string, page: number, llm: LlmClient, opts: { signal?: AbortSignal } = {}): Promise<AnalysisEnvelope> {
  const spec = KIND_REGISTRY["move"];
  const raw = await llm.complete(
    [ { role: "system", content: SYS_MOVE }, { role: "user", content: "句子：「" + String(text || "") + "」" } ],
    { maxTokens: 600, temperature: 0.2, signal: opts.signal },
  );
  const parsed = extractJson(raw) || {};
  const fn = String((parsed && parsed.function) || "").trim();
  const cond = String((parsed && parsed.condition) || "").trim();
  const refs: number[] = page ? [page] : [];
  const claims: AnalysisClaim[] = [{ text: "原句：「" + String(text || "") + "」", pageRefs: refs }];
  if (fn) claims.push({ text: "这句在做什么：" + fn, pageRefs: [] });
  if (cond) claims.push({ text: "什么时候这样写：" + cond, pageRefs: [] });
  return {
    kind: "move", lane: spec.lane, groundability: spec.groundability, sourceBasis: "fulltext", model: llm.model, title: spec.title,
    framing: "这是对该句修辞功能的标注，不是让你照抄句式。若用进自己的稿子，请走「去 AI 味」流程改写，避免雷同。",
    claims,
  };
}

const SYS_FIGURE = "你分析学术论文里的图表。基于给定图像描述其可观察的视觉风格（图型/版式/配色/坐标/误差表达等）；并对其可能的制作工具给出推测，但必须说明无法从静态图确证。不要编造图中没有的数据。仅输出 JSON 对象，含字段 observableStyle（字符串数组，可观察风格标签）、toolGuess（字符串，对制作工具的推测，需含不确定性表述）、howTo（字符串，复刻该风格的大致做法）。不要解释、不要代码围栏。";

// 读图（ADR-I5）：图像走视觉模型，产推断车道信封（风格 c1 / 工具 c3 不可确证）。sourceBasis 标 fulltext+vision。
export async function analyzeFigure(dataUrl: string, caption: string, llm: LlmClient, opts: { signal?: AbortSignal } = {}): Promise<AnalysisEnvelope> {
  const spec = KIND_REGISTRY["figure"];
  const userText = caption ? ("图注/上下文：" + caption + "\n请分析这张图。") : "请分析这张图。";
  const raw = await llm.complete([{ role: "system", content: SYS_FIGURE }, { role: "user", content: userText }], { maxTokens: 700, temperature: 0.2, images: [dataUrl], signal: opts.signal });
  const parsed = extractJson(raw) || {};
  const styles: string[] = Array.isArray(parsed && parsed.observableStyle) ? parsed.observableStyle.map((x: any) => String(x)) : [];
  const claims: AnalysisClaim[] = [];
  if (styles.length) claims.push({ text: "可观察风格：" + styles.join(" · "), pageRefs: [], confidence: "c1" });
  if (parsed && parsed.toolGuess) claims.push({ text: "制作工具推测：" + String(parsed.toolGuess), pageRefs: [], confidence: "c3", flag: "needs_recheck" });
  if (parsed && parsed.howTo) claims.push({ text: "复刻做法：" + String(parsed.howTo), pageRefs: [], confidence: "c1" });
  if (!claims.length) claims.push({ text: "（未能从图像解析出结构化结果，请重试或换用更强的视觉模型）", pageRefs: [], confidence: "c3" });
  return { kind: "figure", lane: spec.lane, groundability: spec.groundability, sourceBasis: "fulltext+vision", model: llm.model, title: spec.title, framing: "以下基于图像的视觉特征；制作工具无法从静态图确证，仅供复刻风格时参考。", claims };
}

// 语料层（ADR-I6）：用户选中工作集的跨篇归纳——map 每篇要点 → reduce 跨篇综合。
// 输入优先：单篇结构化缓存（总结+ledger/recipe/outline）→ 全文摘录 → 摘要；诚实标注覆盖度。
const CORPUS_ZH = "用简体中文写每条 text；关键术语可括号保留英文。";
const CORPUS_PAPER_OUT = "每个元素含 text 与 papers（数组）；papers 每项为对象 { id: 文献 paperId, title: 标题 }。不要编造。";
const SYS_CORPUS: Record<string, string> = {
  corpus_framing: "你在比较多篇论文如何框定同一问题。基于给定各篇材料，归纳：主流框定、不同取向、各取向对应哪些文献。" + CORPUS_ZH + "这是跨文本归纳推断。输出 JSON 对象，含字段 claims（数组）；" + CORPUS_PAPER_OUT + "只输出 JSON。",
  corpus_contradiction: "你在多篇论文之间寻找结论上的冲突或张力。" + CORPUS_ZH + "指出哪些文献在结论/发现上不一致及分歧点；这是跨文本推断、需回各篇核对。输出 JSON 对象，含字段 claims（数组）；" + CORPUS_PAPER_OUT + "只输出 JSON。",
  corpus_recipe: "你在汇编多篇相似研究的方法配方。" + CORPUS_ZH + "归纳共同的方法骨架（设计/数据/结局/指标/统计）及差异，注明多数共识或个别差异。输出 JSON 对象，含字段 claims（数组）；" + CORPUS_PAPER_OUT + "只输出 JSON。",
  corpus_timeline: "你归纳多篇文献中同一主题的观点或发现如何随时间演进。" + CORPUS_ZH + "按时间或逻辑阶段排列，标注哪些文献支持各阶段。输出 JSON 对象，含字段 claims（数组）；" + CORPUS_PAPER_OUT + "只输出 JSON。",
  corpus_gaps: "你找出多篇文献共同未覆盖、或仅一两篇触及的研究空白与开放问题。" + CORPUS_ZH + "不要编造空白；若材料不足则说明。输出 JSON 对象，含字段 claims（数组）；" + CORPUS_PAPER_OUT + "只输出 JSON。",
};
const CORPUS_MAP_SYS = "你是科研阅读助手。只依据单篇材料抽取与跨篇分析任务相关的要点（每条一行，简洁）。" + CORPUS_ZH + "不要编造。若本片无相关要点，只回复「（无）」。不要 JSON。";
const CORPUS_REDUCE_PREFIX = "\n\n【跨篇综合】下面是各篇要点清单（已标注 paperId）。请据此完成跨篇任务；每条结论必须在 papers 中列出真实 paperId 与 title。只用清单中的信息，不杜撰。\n\n— 各篇要点 —\n";

export interface CorpusPaper {
  id: string;
  title: string;
  abstract?: string;
  summary?: string;
  ledgerExcerpt?: string;
  recipeExcerpt?: string;
  outlineExcerpt?: string;
  fulltextExcerpt?: string;
  inputTier: CorpusInputTier;
}

export interface CorpusAnalyzeOptions {
  depth?: CorpusDepth;
  signal?: AbortSignal;
}

function corpusTierLabel(t: CorpusInputTier): string {
  if (t === "structured") return "结构化（总结+深读缓存）";
  if (t === "fulltext_excerpt") return "全文摘录";
  if (t === "summary") return "仅有总结";
  if (t === "abstract") return "仅有摘要";
  return "无可用输入";
}

function buildCorpusCoverage(papers: CorpusPaper[], depth: CorpusDepth): CorpusCoverage {
  const cov: CorpusCoverage = { total: papers.length, structured: 0, summary: 0, abstract: 0, fulltext: 0, none: 0, depth, papers: [] };
  for (const p of papers) {
    cov.papers.push({ id: p.id, title: p.title || "(无题)", tier: p.inputTier });
    if (p.inputTier === "structured") cov.structured++;
    else if (p.inputTier === "summary") cov.summary++;
    else if (p.inputTier === "abstract") cov.abstract++;
    else if (p.inputTier === "fulltext_excerpt") cov.fulltext++;
    else cov.none++;
  }
  return cov;
}

function corpusCoverageBanner(cov: CorpusCoverage): string {
  const parts: string[] = [`共 ${cov.total} 篇`];
  if (cov.structured) parts.push(`${cov.structured} 篇结构化`);
  if (cov.fulltext) parts.push(`${cov.fulltext} 篇含全文摘录`);
  if (cov.summary) parts.push(`${cov.summary} 篇仅总结`);
  if (cov.abstract) parts.push(`${cov.abstract} 篇仅摘要`);
  if (cov.none) parts.push(`${cov.none} 篇无输入（建议先阅读或生成总结）`);
  parts.push(cov.depth === "fulltext_excerpt" ? "深度：全文摘录优先" : "深度：结构化缓存优先");
  return parts.join(" · ");
}

function formatCorpusPaperBody(p: CorpusPaper): string {
  const lines: string[] = [`【文献 id:${p.id} · ${p.title || "(无题)"}】`, `输入层级：${corpusTierLabel(p.inputTier)}`];
  if (p.summary) lines.push("--- 接地总结 ---\n" + p.summary.slice(0, 12000));
  if (p.ledgerExcerpt) lines.push("--- claim 账本要点 ---\n" + p.ledgerExcerpt.slice(0, 8000));
  if (p.recipeExcerpt) lines.push("--- 方法配方要点 ---\n" + p.recipeExcerpt.slice(0, 6000));
  if (p.outlineExcerpt) lines.push("--- 逻辑大纲 ---\n" + p.outlineExcerpt.slice(0, 4000));
  if (p.fulltextExcerpt) lines.push("--- 全文摘录 ---\n" + p.fulltextExcerpt.slice(0, 16000));
  if (p.abstract && !p.summary && !p.ledgerExcerpt) lines.push("--- 摘要 ---\n" + p.abstract.slice(0, 6000));
  if (lines.length <= 2) lines.push("（本篇暂无可用于跨篇分析的正文材料）");
  return lines.join("\n\n");
}

function resolveCorpusPaperRefs(raw: any, papers: CorpusPaper[]): { titles: string[]; ids: string[] } {
  const byId = new Map(papers.map((p) => [p.id, p.title || "(无题)"]));
  const byTitle = new Map(papers.map((p) => [(p.title || "").trim().toLowerCase(), p.id]));
  const titles: string[] = [];
  const ids: string[] = [];
  const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  for (const item of arr) {
    if (item && typeof item === "object") {
      const id = String(item.id || item.paperId || "").trim();
      const title = String(item.title || "").trim() || (id ? byId.get(id) : "") || "";
      if (id && byId.has(id)) { ids.push(id); titles.push(byId.get(id) || title); continue; }
      if (title) {
        const tid = byTitle.get(title.toLowerCase());
        if (tid) { ids.push(tid); titles.push(byId.get(tid) || title); continue; }
        titles.push(title);
      }
      continue;
    }
    const s = String(item || "").trim();
    if (!s) continue;
    const tid = byTitle.get(s.toLowerCase());
    if (tid) { ids.push(tid); titles.push(byId.get(tid) || s); }
    else titles.push(s);
  }
  return { titles: [...new Set(titles)], ids: [...new Set(ids)] };
}

function mapCorpusClaims(arr: any[], spec: KindSpec, papers: CorpusPaper[]): AnalysisClaim[] {
  const claims: AnalysisClaim[] = [];
  for (const c of arr) {
    const text = String((c && c.text) || "").trim();
    if (!text) continue;
    const refs = resolveCorpusPaperRefs(c?.papers ?? c?.paperRefs ?? c?.paperIds, papers);
    const claim: AnalysisClaim = { text, pageRefs: [] };
    if (refs.titles.length) claim.paperRefs = refs.titles;
    if (refs.ids.length) claim.paperRefIds = refs.ids;
    if (spec.lane === "inference") claim.confidence = "c2";
    claims.push(claim);
  }
  return claims;
}

async function mapCorpusPaperNotes(kind: string, paper: CorpusPaper, llm: LlmClient, signal?: AbortSignal): Promise<string> {
  const task = (SYS_CORPUS[kind] || SYS_CORPUS.corpus_framing).split("输出 JSON")[0].trim();
  const out = await llm.complete(
    [{ role: "system", content: CORPUS_MAP_SYS }, { role: "user", content: task + "\n\n" + formatCorpusPaperBody(paper) }],
    { maxTokens: 1000, temperature: 0.2, signal },
  );
  const t = (out || "").trim();
  return t && t !== "（无）" ? `■ id:${paper.id} · ${paper.title || "(无题)"}\n${t}` : "";
}

async function reduceCorpusClaims(
  kind: string,
  papers: CorpusPaper[],
  notes: string,
  spec: KindSpec,
  llm: LlmClient,
  signal?: AbortSignal,
): Promise<AnalysisClaim[]> {
  const instruction = SYS_CORPUS[kind] || SYS_CORPUS.corpus_framing;
  const body = notes.trim() || papers.map((p) => formatCorpusPaperBody(p)).join("\n\n══════\n\n");
  const raw = await llm.complete(
    [{ role: "system", content: "你是严谨的科研阅读助手。只依据用户提供的材料作答，不杜撰。仅输出 JSON 对象，不要解释、不要代码围栏。" }, { role: "user", content: instruction + CORPUS_REDUCE_PREFIX + body }],
    { maxTokens: kind === "corpus_recipe" ? 2800 : 2400, temperature: 0.2, signal },
  );
  const parsed = extractJson(raw) || {};
  const arr: any[] = Array.isArray(parsed?.claims) ? parsed.claims : [];
  return mapCorpusClaims(arr, spec, papers);
}

export async function analyzeCorpus(
  kind: string,
  papers: CorpusPaper[],
  llm: LlmClient,
  opts: CorpusAnalyzeOptions = {},
): Promise<AnalysisEnvelope> {
  const spec = KIND_REGISTRY[kind] || KIND_REGISTRY.corpus_framing;
  const title = spec.title;
  const depth: CorpusDepth = opts.depth === "fulltext_excerpt" ? "fulltext_excerpt" : "structured";
  if (!papers || papers.length < 2) {
    return { kind, lane: spec.lane, groundability: spec.groundability, sourceBasis: "corpus", model: "(none)", title, refused: { reason: "跨篇分析至少需要 2 篇文献。" }, claims: [] };
  }
  const usable = papers.filter((p) => p.inputTier !== "none");
  if (usable.length < 2) {
    return {
      kind, lane: spec.lane, groundability: spec.groundability, sourceBasis: "corpus", model: llm.model, title,
      refused: { reason: `所选 ${papers.length} 篇中仅 ${usable.length} 篇有可用材料。请先在阅读器打开 PDF 并生成「整篇总结」或「claim 账本」，再重试跨篇分析。` },
      coverage: buildCorpusCoverage(papers, depth), claims: [],
    };
  }
  const coverage = buildCorpusCoverage(papers, depth);
  const banner = corpusCoverageBanner(coverage);
  let claims: AnalysisClaim[] = [];
  if (usable.length <= 2 && papers.map((p) => formatCorpusPaperBody(p)).join("").length < 28000) {
    claims = await reduceCorpusClaims(kind, papers, "", spec, llm, opts.signal);
  } else {
    const mapped = await Promise.all(papers.map((p) => mapCorpusPaperNotes(kind, p, llm, opts.signal).catch(() => "")));
    const notes = mapped.filter(Boolean).join("\n\n");
    claims = await reduceCorpusClaims(kind, papers, notes, spec, llm, opts.signal);
  }
  if (!claims.length) {
    claims.push({ text: "（未能从所选文献归纳出结构化结果——请确认已生成阅读器总结或打开过 PDF 建立全文索引，或更换选择）", pageRefs: [], confidence: "c3" });
  }
  const framing = spec.lane === "inference"
    ? "这是基于多篇结构化要点/总结的跨文本归纳，非任一篇的原文事实；点击出处文献可打开阅读器核对。"
    : "这是对多篇方法的汇编，逐条注明出处文献；细节请回各篇原文核对。";
  return { kind, lane: spec.lane, groundability: spec.groundability, sourceBasis: "corpus", model: llm.model, title, framing, banner, coverage, claims };
}

// 逻辑流程图（flowmap）：LLM 只产结构化 nodes+edges（JSON），前端确定性渲染——绝不让模型直接画 SVG（防幻觉黑箱，研究公认做法）。
// 每节点 pageRefs 经真实页码过滤；引用不存在节点的边被丢弃；无页码节点保留但前端标灰（暴露而非静默删除）。整图走推断车道。
const FLOWMAP_CAP = 52000;
const FLOWMAP_MAP_SUFFIX = "\n\n【分段说明】以下仅是论文连续片段之一；只抽取本片段中出现的流程步骤与依赖，页码用片段内真实 [p.N]。不要编造步骤。";

function parseFlowmapPayload(parsed: any, valid: Set<number>): { nodes: { id: string; label: string; pageRefs: number[] }[]; edges: { from: string; to: string; label?: string }[] } {
  const rawNodes: any[] = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const nodes = rawNodes.map((n: any, i: number) => {
    const refs = claimPageRefs(n, valid);
    const label = String((n && (n.label ?? n.text ?? n.title ?? n.name)) || "").trim().slice(0, 40);
    return { id: String((n && n.id) || ("n" + i)), label, pageRefs: refs };
  }).filter((n) => n.label.length > 0);
  const ids = new Set(nodes.map((n) => n.id));
  const rawEdges: any[] = Array.isArray(parsed?.edges) ? parsed.edges : [];
  const edges = rawEdges.map((e: any) => {
    const edge: { from: string; to: string; label?: string } = { from: String((e && e.from) || ""), to: String((e && e.to) || "") };
    if (e && e.label) edge.label = String(e.label).trim().slice(0, 16);
    return edge;
  }).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  return { nodes, edges };
}

function mergeFlowmapParts(parts: { nodes: { id: string; label: string; pageRefs: number[] }[]; edges: { from: string; to: string; label?: string }[] }[]): { nodes: { id: string; label: string; pageRefs: number[] }[]; edges: { from: string; to: string; label?: string }[] } {
  const nodeKey = (n: { label: string; pageRefs: number[] }) => n.label + "|" + n.pageRefs.join(",");
  const seen = new Map<string, string>();
  const nodes: { id: string; label: string; pageRefs: number[] }[] = [];
  const idRemap = new Map<string, string>();
  for (const part of parts) {
    for (const n of part.nodes) {
      const k = nodeKey(n);
      if (seen.has(k)) { idRemap.set(n.id, seen.get(k)!); continue; }
      const nid = "n" + nodes.length;
      seen.set(k, nid);
      idRemap.set(n.id, nid);
      nodes.push({ id: nid, label: n.label, pageRefs: n.pageRefs });
    }
  }
  const edgeSeen = new Set<string>();
  const edges: { from: string; to: string; label?: string }[] = [];
  for (const part of parts) {
    for (const e of part.edges) {
      const from = idRemap.get(e.from);
      const to = idRemap.get(e.to);
      if (!from || !to || from === to) continue;
      const ek = from + ">" + to + (e.label || "");
      if (edgeSeen.has(ek)) continue;
      edgeSeen.add(ek);
      edges.push({ from, to, label: e.label });
    }
  }
  return { nodes, edges };
}

async function runFlowmap(kind: string, pages: ReaderPage[], spec: KindSpec, llm: LlmClient, opts: { signal?: AbortSignal } = {}): Promise<AnalysisEnvelope> {
  const instruction = PROMPTS[kind];
  const valid = new Set<number>(pages.map((p) => p.page));
  let graph: { nodes: { id: string; label: string; pageRefs: number[] }[]; edges: { from: string; to: string; label?: string }[] };
  let banner: string | undefined;
  if (pagesTextLen(pages) > FLOWMAP_CAP) {
    const chunks = chunkByPages(pages, MR_CHUNK, MR_MAX_CHUNKS);
    const parts = await Promise.all(chunks.map(async (chunk) => {
      const body = chunk.map((p) => `[p.${p.page}] ${p.text}`).join("\n\n");
      const raw = await llm.complete(
        [{ role: "system", content: SYS }, { role: "user", content: instruction + FLOWMAP_MAP_SUFFIX + "\n\n正文片段：\n" + body }],
        { maxTokens: OUTPUT_MAXTOK[kind] ?? 1400, temperature: 0.2, signal: opts.signal },
      );
      return parseFlowmapPayload(extractJson(raw) || {}, valid);
    }));
    graph = mergeFlowmapParts(parts);
    banner = coverageBanner(pages, chunks.length);
  } else {
    const raw = await llm.complete(
      [{ role: "system", content: SYS }, { role: "user", content: instruction + "\n\n正文：\n" + pagesText(pages, FLOWMAP_CAP) }],
      { maxTokens: OUTPUT_MAXTOK[kind] ?? 1400, temperature: 0.2, signal: opts.signal },
    );
    const parsed: any = extractJson(raw) || {};
    const rawTrim = String(raw || "").trim();
    if (!rawTrim) throw new Error("模型未返回任何内容，无法重建流程图。请重试或更换模型。");
    graph = parseFlowmapPayload(parsed, valid);
    banner = pages.length > 1 ? `已扫描全文 ${pages.length} 页` : undefined;
  }
  if (!graph.nodes.length) {
    throw new Error("模型未返回有效流程节点。请重试；若正文方法描述很简略，可换更强模型。");
  }
  return { kind, lane: spec.lane, groundability: spec.groundability, sourceBasis: "fulltext", model: llm.model, title: spec.title, framing: spec.framing, banner, graph, claims: [] };
}

const GENESIS_SPEC_PROMPT =
  "这不是还原作者真实发现过程（单篇论文不可能），而是基于本篇 Introduction/方法/结果的事后叙事链，推测作者「可能」的研究路径。" +
  "每条 text 必须以「推测：」开头；说明依据哪段正文；不得写成确定事实；不得引入正文之外的知识。" +
  "输出 JSON 对象，含字段 claims（数组）；每个元素含 text 与 pageRefs（整数数组，可为空）。只输出该 JSON。";

/** genesis·标注推测（L3 opt-in）：用户显式请求后才调用；全程 c3、推断车道。 */
async function runGenesisSpeculative(pages: ReaderPage[], spec: KindSpec, llm: LlmClient, opts: { signal?: AbortSignal } = {}): Promise<AnalysisEnvelope> {
  const valid = new Set<number>(pages.map((p) => p.page));
  let arr: any[] = [];
  let banner: string | undefined;
  if (needsMapReduce("limitations", pages)) {
    const chunks = chunkByPages(pages, MR_CHUNK, MR_MAX_CHUNKS);
    const mapped = await Promise.all(chunks.map(async (chunk) => {
      const body = chunk.map((p) => `[p.${p.page}] ${p.text}`).join("\n\n");
      const raw = await llm.complete(
        [{ role: "system", content: SYS }, { role: "user", content: GENESIS_SPEC_PROMPT + MAP_CHUNK_SUFFIX + "\n\n正文片段：\n" + body }],
        { maxTokens: 1200, temperature: 0.25, signal: opts.signal },
      );
      return pickClaimsArray(extractJson(raw)) || [];
    }));
    arr = mapped.flat();
    banner = coverageBanner(pages, chunks.length);
  } else {
    const raw = await llm.complete(
      [{ role: "system", content: SYS }, { role: "user", content: GENESIS_SPEC_PROMPT + "\n\n正文：\n" + pagesText(pages, 32000) }],
      { maxTokens: 1600, temperature: 0.25, signal: opts.signal },
    );
    arr = pickClaimsArray(extractJson(raw)) || [];
    banner = pages.length > 1 ? `已扫描全文 ${pages.length} 页` : undefined;
  }
  const claims = dedupeClaims(mapClaimsFromArray(arr, "genesis", spec, valid).map((c) => ({
    ...c,
    confidence: "c3" as const,
    flag: "needs_recheck" as const,
    text: c.text.startsWith("推测") ? c.text : "推测：" + c.text,
  })));
  return {
    kind: "genesis", lane: spec.lane, groundability: "L3", sourceBasis: "fulltext", model: llm.model, title: spec.title,
    framing: "以下为 AI 基于正文叙事链的标注推测，不是作者真实发现过程，不可引用为事实。请回原文核对后再采信。",
    speculative: true, banner, claims,
  };
}

/** 分析器族单一派发口（ADR-I2）。L3 默认静态拒绝；genesis 可 opt-in 推测。实现全部分析器族（含 flowmap 逻辑流程图）。 */
// 整体推断度（保守·透明）：证据车道结论里若出现"作者真实发现过程/私下动机"式断言（≠论证逻辑），标 needs_recheck 提示人核对。
// 不静默改车道——可靠的车道级降级分类器是真机 spike（HC-3）；此处只加"需核对"标，只更保守、不洗白。
const INTENT_MARKERS = ["作者真的", "作者其实", "作者私下", "作者最初", "作者当初", "作者本来想", "灵感来自", "之所以想到", "动机是"];
function flagIntentReconstruction(env: AnalysisEnvelope): AnalysisEnvelope {
  if (env.lane !== "evidence") return env;
  for (const c of env.claims) {
    if (!c.flag && INTENT_MARKERS.some((m) => c.text.includes(m))) c.flag = "needs_recheck";
  }
  return env;
}

export async function analyzeReader(kind: string, pages: ReaderPage[], deps: { llm: LlmClient; signal?: AbortSignal; text?: string; page?: number; speculative?: boolean }): Promise<AnalysisEnvelope> {
  const spec = KIND_REGISTRY[kind];
  if (!spec) throw new Error("analyzeReader: 未知 kind：" + kind);
  if (kind === "move") return runMove(String(deps.text || ""), deps.page || 0, deps.llm, deps);
  if (kind === "flowmap") return runFlowmap(kind, pages, spec, deps.llm, deps);
  if (kind === "genesis" && !deps.speculative) {
    return {
      kind, lane: spec.lane, groundability: "L3", sourceBasis: "external", model: "(none)", title: spec.title,
      refused: { reason: "单篇已发表论文无法还原作者真实的发现过程；论文 Introduction 是事后整理的论证逻辑，不是发现的记录——把它当作「作者怎么想到的」会严重误导。" },
      framing: "如需逼近，只能基于被引脉络 / 该课题组其他论文 / 预印本版本差异做推测，且全程标「推测」（需接入外部数据源）。你也可以在下方显式请求「标注推测」——仅作联想，不可当作事实。",
      claims: [], practice: spec.practice,
    };
  }
  if (kind === "genesis" && deps.speculative) {
    return runGenesisSpeculative(pages, spec, deps.llm, deps);
  }
  return flagIntentReconstruction(await runStructured(kind, pages, spec, deps.llm, deps));
}
