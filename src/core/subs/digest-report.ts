// 订阅简报 · 今日总报告（跨篇 AI 归纳，基于标题+摘要）
import type { Paper } from "../model.ts";
import type { LlmClient } from "../summarize/types.ts";
import type { Store } from "../store/index.ts";
import {
  dedupeDigestPapers,
  normalizeSubscription,
  subscriptionReadIds,
  todayPaperList,
  unreadTodayCount,
} from "./digest-search.ts";

export const DIGEST_REPORT_CAP = 50;
/** 超过此毫秒仍停留在 generating，视为进程中断（重启/崩溃），读库时降级为 failed 以便重试 */
export const DIGEST_REPORT_GENERATING_STALE_MS = 120_000;
export const DIGEST_REPORT_DISCLAIMER =
  "推断 · 基于标题与摘要 · 是否纳入你的研究由你判断";

export type DigestReportStatus = "idle" | "generating" | "ready" | "failed" | "skipped";

export interface DigestReportTheme {
  title: string;
  summary: string;
  paperIds: string[];
}

export interface DigestReportPick {
  paperId: string;
  title: string;
  reason: string;
}

export interface DigestReport {
  dateKey: string;
  scope: "all" | string;
  status: DigestReportStatus;
  generatedAt?: string;
  model?: string;
  paperCount: number;
  subCount: number;
  unreadCount: number;
  headline?: string;
  highlights: string[];
  themes: DigestReportTheme[];
  priorityPicks: DigestReportPick[];
  skippedReason?: string;
  error?: string;
}

export interface DigestReportPaperInput {
  id: string;
  title: string;
  abstract: string;
  subLabels: string[];
  preprint: boolean;
}

function dateKeyOf(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function digestReportStorageKey(dateKey: string, scope: string): string {
  return `digest_report:${dateKey}:${scope}`;
}

export function emptyDigestReport(dateKey: string, scope: "all" | string): DigestReport {
  return {
    dateKey,
    scope,
    status: "idle",
    paperCount: 0,
    subCount: 0,
    unreadCount: 0,
    highlights: [],
    themes: [],
    priorityPicks: [],
  };
}

export function collectDigestReportInputs(
  subs: Record<string, unknown>[],
  scopeSubId: "all" | string = "all",
): { inputs: DigestReportPaperInput[]; subCount: number; unreadCount: number } {
  const enabled = (Array.isArray(subs) ? subs : [])
    .map((s) => normalizeSubscription(s))
    .filter((s) => s.enabled !== false);
  const scoped = scopeSubId === "all"
    ? enabled
    : enabled.filter((s) => String(s.id) === scopeSubId);
  const entries: Array<{ subId: string; subLabel: string; paper: Paper }> = [];
  for (const sub of scoped) {
    const read = subscriptionReadIds(sub);
    const label = String(sub.name || sub.q || "订阅").slice(0, 80);
    for (const p of todayPaperList(sub)) {
      if (read.has(p.id)) continue;
      entries.push({ subId: String(sub.id), subLabel: label, paper: p });
    }
  }
  const deduped = dedupeDigestPapers(entries).slice(0, DIGEST_REPORT_CAP);
  const inputs: DigestReportPaperInput[] = deduped.map(({ paper, subLabels }) => ({
    id: paper.id,
    title: String(paper.title || "(无标题)").slice(0, 240),
    abstract: String(paper.abstract || "").slice(0, 600),
    subLabels,
    preprint: !!paper.isPreprint,
  }));
  return {
    inputs,
    subCount: scoped.length,
    unreadCount: scoped.reduce((n, s) => n + unreadTodayCount(s), 0),
  };
}

export function recoverStaleGeneratingReport(report: DigestReport): DigestReport {
  if (report.status !== "generating") return report;
  const at = report.generatedAt ? new Date(report.generatedAt).getTime() : 0;
  if (!at || Date.now() - at < DIGEST_REPORT_GENERATING_STALE_MS) return report;
  return {
    ...report,
    status: "failed",
    error: "generation_interrupted",
  };
}

export function loadDigestReport(store: Store, dateKey: string, scope: "all" | string): DigestReport {
  try {
    store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
    const key = digestReportStorageKey(dateKey, scope);
    const r = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(key) as { payload?: string } | undefined;
    if (!r?.payload) return emptyDigestReport(dateKey, scope);
    const parsed = JSON.parse(r.payload) as DigestReport;
    const merged = { ...emptyDigestReport(dateKey, scope), ...parsed, dateKey, scope };
    return recoverStaleGeneratingReport(merged);
  } catch {
    return emptyDigestReport(dateKey, scope);
  }
}

export function saveDigestReport(store: Store, report: DigestReport): void {
  store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
  const key = digestReportStorageKey(report.dateKey, report.scope);
  store.db.prepare(
    "INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
  ).run(key, JSON.stringify(report), report.generatedAt || new Date().toISOString());
}

// 从坏 JSON 起始 { 处提取顶层平衡对象（字符串/转义安全），遇顶层 ] 停。
function salvageObjects(s: string, fromBracket: number): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = fromBracket; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; } }
    else if (c === "]" && depth === 0) break;
  }
  return out;
}

// 截断/脏 JSON 救援：定位 "key":[ 后逐个对象 parse，丢弃坏的那个（拿回完整的前几条）。
function salvageArray(raw: string, key: string): Record<string, unknown>[] | null {
  const m = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(raw);
  if (!m) return null;
  const objs = salvageObjects(raw, m.index + m[0].length - 1);
  const arr: Record<string, unknown>[] = [];
  for (const o of objs) { try { arr.push(JSON.parse(o) as Record<string, unknown>); } catch { /* drop bad */ } }
  return arr.length ? arr : null;
}

export interface ReportCaps { highlights: number; themes: number; picks: number; themePapers: number; }

function parseReportJson(raw: string, inputs: DigestReportPaperInput[], caps: ReportCaps): Partial<DigestReport> {
  const idSet = new Set(inputs.map((p) => p.id));
  const titleById = new Map(inputs.map((p) => [p.id, p.title]));
  const trimmed = (raw || "").trim();
  let obj: Record<string, unknown> | null = null;
  try {
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    obj = JSON.parse(trimmed.slice(jsonStart >= 0 ? jsonStart : 0, jsonEnd >= 0 ? jsonEnd + 1 : trimmed.length)) as Record<string, unknown>;
  } catch {
    // 截断救援：尽量从坏 JSON 里捞回各数组与 headline，避免把原文当一条要点直接抛给用户。
    const hMatch = /"highlights"\s*:\s*\[([\s\S]*?)\]/.exec(trimmed);
    let sH: unknown = null;
    if (hMatch) { try { sH = JSON.parse("[" + hMatch[1] + "]"); } catch { sH = null; } }
    const sT = salvageArray(trimmed, "themes");
    const sP = salvageArray(trimmed, "priorityPicks");
    const headMatch = /"headline"\s*:\s*"([^"]{1,200})"/.exec(trimmed);
    if (sH || sT || sP || headMatch) {
      obj = { headline: headMatch ? headMatch[1] : undefined, highlights: sH || [], themes: sT || [], priorityPicks: sP || [] };
    } else {
      return { highlights: ["本次结构化结果不完整（可能被模型截断），请点「刷新」重试，或在设置中换用上下文更长的模型。"], themes: [], priorityPicks: [], headline: undefined };
    }
  }
  const o = obj || {};
  const highlights = Array.isArray(o.highlights)
    ? o.highlights.map((h) => String(h).trim().slice(0, 280)).filter(Boolean).slice(0, caps.highlights)
    : [];
  const themes: DigestReportTheme[] = Array.isArray(o.themes)
    ? o.themes.slice(0, caps.themes).map((t: Record<string, unknown>) => ({
        title: String(t.title || "主题").slice(0, 80),
        summary: String(t.summary || "").slice(0, 600),
        paperIds: (Array.isArray(t.paperIds) ? t.paperIds : [])
          .map(String)
          .filter((id) => idSet.has(id))
          .slice(0, caps.themePapers),
      })).filter((t) => t.summary)
    : [];
  const priorityPicks: DigestReportPick[] = Array.isArray(o.priorityPicks)
    ? o.priorityPicks.slice(0, caps.picks).map((p: Record<string, unknown>) => {
        const paperId = String(p.paperId || "");
        return {
          paperId,
          title: titleById.get(paperId) || String(p.title || "").slice(0, 200),
          reason: String(p.reason || "").slice(0, 280),
        };
      }).filter((p) => p.paperId && idSet.has(p.paperId) && p.reason)
    : [];
  const headline = o.headline ? String(o.headline).slice(0, 200) : (highlights[0] || undefined);
  return { headline, highlights, themes, priorityPicks };
}

const SYS_ALL = `你是学术文献「今日证据简报」主编。用户今天订阅了若干主题，下面是跨**所有**订阅命中的论文（标题+摘要）。写一份「跨主题综合概览」——突出广度、以及不同主题之间的呼应与对比。
规则：
- 只使用给定文献信息，不编造事实、不替用户做纳入/排除判断
- 用中文，简洁、有编辑视角
- 若摘要缺失较多，在 highlights 中说明依据有限
- 只输出一个 JSON 对象，字段：
  headline（一句话总览，≤60字，点出今天跨主题的整体图景）
  highlights（数组，3-5条，今日最重要的跨主题要点）
  themes（数组，2-4组；每组 title、summary（1-2句，可跨订阅）、paperIds（文献 id 数组））
  priorityPicks（数组，3-5条；每条 paperId、reason（为何值得优先看，1句））
不要 markdown，不要多余文字。`;

const SYS_SINGLE = `你是学术文献单主题「今日深度简报」编辑。下面是用户**某一个**订阅主题今天命中的论文（标题+摘要）。写一份比综合概览更**细致、更有层次**的单主题报告——突出深度。
规则：
- 只使用给定文献信息，不编造事实、不替用户做纳入/排除判断
- 用中文，信息密度高但仍清晰；尽量写清各文献之间的方法/结论差异与联系
- 若摘要缺失较多，在 highlights 中说明依据有限
- 只输出一个 JSON 对象，字段：
  headline（一句话点出该主题今天的核心进展，≤60字）
  highlights（数组，4-6条，更细的要点：方法 / 发现 / 争议 / 趋势）
  themes（数组，3-6组，更细的子方向；每组 title、summary（2-3句，写清差异与联系）、paperIds（文献 id 数组））
  priorityPicks（数组，4-8条；每条 paperId、reason（为何值得优先看，1-2句，可点出与其他文献的关系））
不要 markdown，不要多余文字。`;

const CAPS_ALL: ReportCaps = { highlights: 5, themes: 4, picks: 5, themePapers: 8 };
const CAPS_SINGLE: ReportCaps = { highlights: 6, themes: 6, picks: 8, themePapers: 10 };

export async function generateDigestReportContent(
  inputs: DigestReportPaperInput[],
  llm: LlmClient,
  scope: "all" | string = "all",
): Promise<Partial<DigestReport>> {
  if (!inputs.length) {
    return { highlights: ["今日没有待读文献。"], themes: [], priorityPicks: [], headline: "今日没有待读" };
  }
  const single = scope !== "all";
  const lines = inputs.map((p, i) => {
    const tags = [p.preprint ? "预印本" : null, ...p.subLabels.map((l) => `订阅:${l}`)].filter(Boolean).join(" · ");
    const abs = p.abstract.trim() || "（无摘要，仅标题/metadata）";
    return `[${i + 1}] id=${p.id}\n标题：${p.title}\n${tags ? "标签：" + tags + "\n" : ""}摘要：${abs}`;
  }).join("\n\n");
  const text = await llm.complete([
    { role: "system", content: single ? SYS_SINGLE : SYS_ALL },
    { role: "user", content: `今日共 ${inputs.length} 篇待读：\n\n${lines}` },
  ], { maxTokens: single ? 3800 : 2200, temperature: 0.25 });
  return parseReportJson(text || "", inputs, single ? CAPS_SINGLE : CAPS_ALL);
}

export async function runDigestReportGeneration(
  store: Store,
  llm: LlmClient,
  subs: Record<string, unknown>[],
  scope: "all" | string = "all",
  dateKey = dateKeyOf(),
): Promise<DigestReport> {
  const { inputs, subCount, unreadCount } = collectDigestReportInputs(subs, scope);
  const base = emptyDigestReport(dateKey, scope);
  if (!inputs.length) {
    const skipped: DigestReport = {
      ...base,
      status: "skipped",
      skippedReason: "no_unread",
      subCount,
      unreadCount,
      generatedAt: new Date().toISOString(),
    };
    saveDigestReport(store, skipped);
    return skipped;
  }
  const generating: DigestReport = {
    ...base,
    status: "generating",
    paperCount: inputs.length,
    subCount,
    unreadCount,
    generatedAt: new Date().toISOString(),
  };
  saveDigestReport(store, generating);
  try {
    const parsed = await generateDigestReportContent(inputs, llm, scope);
    const ready: DigestReport = {
      ...generating,
      status: "ready",
      model: llm.model,
      ...parsed,
      highlights: parsed.highlights || [],
      themes: parsed.themes || [],
      priorityPicks: parsed.priorityPicks || [],
      generatedAt: new Date().toISOString(),
    };
    saveDigestReport(store, ready);
    return ready;
  } catch (e) {
    const failed: DigestReport = {
      ...generating,
      status: "failed",
      error: (e && (e as Error).message) || "generate_failed",
      generatedAt: new Date().toISOString(),
    };
    saveDigestReport(store, failed);
    return failed;
  }
}

export { dateKeyOf };
