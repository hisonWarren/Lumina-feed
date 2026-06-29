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

export function loadDigestReport(store: Store, dateKey: string, scope: "all" | string): DigestReport {
  try {
    store.db.exec("CREATE TABLE IF NOT EXISTS sources_cache(key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT);");
    const key = digestReportStorageKey(dateKey, scope);
    const r = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(key) as { payload?: string } | undefined;
    if (!r?.payload) return emptyDigestReport(dateKey, scope);
    const parsed = JSON.parse(r.payload) as DigestReport;
    return { ...emptyDigestReport(dateKey, scope), ...parsed, dateKey, scope };
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

function parseReportJson(raw: string, inputs: DigestReportPaperInput[]): Partial<DigestReport> {
  const idSet = new Set(inputs.map((p) => p.id));
  const titleById = new Map(inputs.map((p) => [p.id, p.title]));
  let obj: Record<string, unknown>;
  try {
    const trimmed = raw.trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    obj = JSON.parse(trimmed.slice(jsonStart >= 0 ? jsonStart : 0, jsonEnd >= 0 ? jsonEnd + 1 : trimmed.length));
  } catch {
    return { highlights: [raw.slice(0, 400)], themes: [], priorityPicks: [] };
  }
  const highlights = Array.isArray(obj.highlights)
    ? obj.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 5)
    : [];
  const themes: DigestReportTheme[] = Array.isArray(obj.themes)
    ? obj.themes.slice(0, 5).map((t: Record<string, unknown>) => ({
        title: String(t.title || "主题").slice(0, 80),
        summary: String(t.summary || "").slice(0, 500),
        paperIds: (Array.isArray(t.paperIds) ? t.paperIds : [])
          .map(String)
          .filter((id) => idSet.has(id))
          .slice(0, 8),
      })).filter((t) => t.summary)
    : [];
  const priorityPicks: DigestReportPick[] = Array.isArray(obj.priorityPicks)
    ? obj.priorityPicks.slice(0, 5).map((p: Record<string, unknown>) => {
        const paperId = String(p.paperId || "");
        return {
          paperId,
          title: titleById.get(paperId) || String(p.title || "").slice(0, 200),
          reason: String(p.reason || "").slice(0, 240),
        };
      }).filter((p) => p.paperId && idSet.has(p.paperId) && p.reason)
    : [];
  const headline = obj.headline ? String(obj.headline).slice(0, 200) : (highlights[0] || undefined);
  return { headline, highlights, themes, priorityPicks };
}

const SYS = `你是学术文献「今日证据简报」编辑。基于用户今日订阅命中的论文标题与摘要，写一份跨篇归纳报告。
规则：
- 只使用给定文献信息，不编造事实、不替用户做纳入/排除判断
- 用中文，简洁可读
- 若摘要缺失较多，在 highlights 中说明依据有限
- 只输出一个 JSON 对象，字段：
  headline（一句话总览，≤60字）
  highlights（数组，3-5条，今日最重要的跨篇要点）
  themes（数组，2-4组；每组 title、summary（1-2句）、paperIds（文献 id 数组））
  priorityPicks（数组，3-5条；每条 paperId、reason（为何值得优先看，1句））
不要 markdown，不要多余文字。`;

export async function generateDigestReportContent(
  inputs: DigestReportPaperInput[],
  llm: LlmClient,
): Promise<Partial<DigestReport>> {
  if (!inputs.length) {
    return { highlights: ["今日没有待读文献。"], themes: [], priorityPicks: [], headline: "今日没有待读" };
  }
  const lines = inputs.map((p, i) => {
    const tags = [p.preprint ? "预印本" : null, ...p.subLabels.map((l) => `订阅:${l}`)].filter(Boolean).join(" · ");
    const abs = p.abstract.trim() || "（无摘要，仅标题/metadata）";
    return `[${i + 1}] id=${p.id}\n标题：${p.title}\n${tags ? "标签：" + tags + "\n" : ""}摘要：${abs}`;
  }).join("\n\n");
  const text = await llm.complete([
    { role: "system", content: SYS },
    { role: "user", content: `今日共 ${inputs.length} 篇待读：\n\n${lines}` },
  ], { maxTokens: 2200, temperature: 0.25 });
  return parseReportJson(text || "", inputs);
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
    const parsed = await generateDigestReportContent(inputs, llm);
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
