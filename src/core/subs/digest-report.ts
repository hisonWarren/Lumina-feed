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
/** 跨订阅综合报告：更高上限 + 公平采样，避免大订阅独占输入 */
export const DIGEST_REPORT_CAP_ALL = 80;
/** 多订阅综合：每个订阅至少入模篇数（再轮询填满 cap） */
export const DIGEST_REPORT_MIN_PER_SUB = 15;
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

/** scope=all 时，每个订阅在完整报告中的独立 Spotlight */
export interface DigestReportSubSpotlight {
  subLabel: string;
  summary: string;
  paperIds: string[];
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
  /** 短标题（折叠态 / 报告页眉） */
  headline?: string;
  /** 一段话简报（扫描列表展示；与完整报告同时生成） */
  brief?: string;
  highlights: string[];
  themes: DigestReportTheme[];
  priorityPicks: DigestReportPick[];
  /** scope=all：各订阅分述（完整报告「各订阅今日」） */
  subSpotlights?: DigestReportSubSpotlight[];
  /** scope=all 时，至少有一篇进入 LLM 输入的订阅 id（用于陈旧检测） */
  contributingSubIds?: string[];
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

type DigestEntry = { subId: string; subLabel: string; paper: Paper };

/** 跨订阅分层取样：先保证每订阅最低配额，再轮询填满 cap */
function fairCapDigestEntries(entries: DigestEntry[], cap: number): DigestEntry[] {
  if (entries.length <= cap) return entries;
  const bySub = new Map<string, DigestEntry[]>();
  for (const e of entries) {
    const list = bySub.get(e.subId) || [];
    list.push(e);
    bySub.set(e.subId, list);
  }
  const subIds = [...bySub.keys()];
  if (subIds.length <= 1) return entries.slice(0, cap);

  const minEach = Math.min(
    DIGEST_REPORT_MIN_PER_SUB,
    Math.max(8, Math.floor(cap / subIds.length)),
  );
  const idx = new Map(subIds.map((id) => [id, 0]));
  const out: DigestEntry[] = [];

  for (const subId of subIds) {
    const list = bySub.get(subId)!;
    const take = Math.min(minEach, list.length);
    for (let i = 0; i < take && out.length < cap; i++) out.push(list[i]);
    idx.set(subId, take);
  }
  while (out.length < cap) {
    let progress = false;
    for (const subId of subIds) {
      if (out.length >= cap) break;
      const list = bySub.get(subId)!;
      const i = idx.get(subId)!;
      if (i < list.length) {
        out.push(list[i]);
        idx.set(subId, i + 1);
        progress = true;
      }
    }
    if (!progress) break;
  }
  return out;
}

export function collectDigestReportInputs(
  subs: Record<string, unknown>[],
  scopeSubId: "all" | string = "all",
  dateKey?: string,
): { inputs: DigestReportPaperInput[]; subCount: number; unreadCount: number; contributingSubIds: string[] } {
  const enabled = (Array.isArray(subs) ? subs : [])
    .map((s) => normalizeSubscription(s))
    .filter((s) => s.enabled !== false);
  const scopedRaw = scopeSubId === "all"
    ? enabled
    : enabled.filter((s) => String(s.id) === scopeSubId);
  // 确保「当日」：只纳入 todayDateKey === 报告日 的订阅，避免昨天未运行的 today[] 混进今天的报告
  const scoped = dateKey
    ? scopedRaw.filter((s) => String(s.todayDateKey || "") === dateKey)
    : scopedRaw;
  const entries: DigestEntry[] = [];
  for (const sub of scoped) {
    const read = subscriptionReadIds(sub);
    const label = String(sub.name || sub.q || "订阅").slice(0, 80);
    for (const p of todayPaperList(sub)) {
      if (read.has(p.id)) continue;
      entries.push({ subId: String(sub.id), subLabel: label, paper: p });
    }
  }
  const allScope = scopeSubId === "all";
  const cap = allScope ? DIGEST_REPORT_CAP_ALL : DIGEST_REPORT_CAP;
  const capped = allScope ? fairCapDigestEntries(entries, cap) : entries.slice(0, cap);
  const deduped = dedupeDigestPapers(capped).slice(0, cap);
  const inputs: DigestReportPaperInput[] = deduped.map(({ paper, subLabels }) => ({
    id: paper.id,
    title: String(paper.title || "(无标题)").slice(0, 240),
    abstract: String(paper.abstract || "").slice(0, 600),
    subLabels,
    preprint: !!paper.isPreprint,
  }));
  const contributingSubIds = [...new Set(deduped.flatMap((d) => d.subIds))].sort();
  return {
    inputs,
    subCount: scoped.length,
    unreadCount: scoped.reduce((n, s) => n + unreadTodayCount(s), 0),
    contributingSubIds,
  };
}

/** 当前订阅状态是否要求重新生成报告（与 collectDigestReportInputs 语义对齐） */
export function digestReportNeedsRefresh(
  report: DigestReport | null | undefined,
  subs: Record<string, unknown>[],
  scope: "all" | string,
  dateKey = dateKeyOf(),
): boolean {
  if (!report || report.status === "idle") return true;
  if (report.status !== "ready") return false;
  const { unreadCount, subCount, contributingSubIds } = collectDigestReportInputs(subs, scope, dateKey);
  if (report.unreadCount !== unreadCount || report.subCount !== subCount) return true;
  if (scope === "all") {
    const enabled = (Array.isArray(subs) ? subs : [])
      .map((s) => normalizeSubscription(s))
      .filter((s) => s.enabled !== false);
    const expected = enabled
      .filter((s) => {
        if (dateKey && String(s.todayDateKey || "") !== dateKey) return false;
        return unreadTodayCount(s) > 0;
      })
      .map((s) => String(s.id))
      .sort();
    if (!report.contributingSubIds?.length || !report.brief) return expected.length > 0;
    const covered = report.contributingSubIds.slice().sort();
    if (expected.length !== covered.length) return true;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== covered[i]) return true;
    }
    if (expected.length > 1 && (!report.subSpotlights || report.subSpotlights.length < expected.length)) return true;
  }
  if (!report.brief) return true;
  return false;
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

export function skipDigestReportNoContent(
  store: Store,
  dateKey: string,
  scope: "all" | string,
  skippedReason: "no_unread" | "no_subs" = "no_unread",
): DigestReport {
  const report: DigestReport = {
    ...emptyDigestReport(dateKey, scope),
    status: "skipped",
    skippedReason,
    generatedAt: new Date().toISOString(),
  };
  saveDigestReport(store, report);
  return report;
}

/** 无待读/无订阅时，把 generating 等悬空状态落为 skipped（删除订阅、清空后读库） */
export function reconcileDigestReportForSubs(
  store: Store,
  subs: Record<string, unknown>[],
  dateKey: string,
  scope: "all" | string,
): DigestReport {
  const { inputs, subCount } = collectDigestReportInputs(subs, scope, dateKey);
  if (inputs.length) return loadDigestReport(store, dateKey, scope);
  const report = loadDigestReport(store, dateKey, scope);
  if (report.status === "generating" || report.status === "ready" || report.status === "failed") {
    return skipDigestReportNoContent(store, dateKey, scope, subCount === 0 ? "no_subs" : "no_unread");
  }
  return report;
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
  const brief = o.brief ? String(o.brief).trim().slice(0, 320) : undefined;
  const subSpotlights: DigestReportSubSpotlight[] = Array.isArray(o.subSpotlights)
    ? o.subSpotlights.slice(0, 8).map((s: Record<string, unknown>) => ({
        subLabel: String(s.subLabel || s.label || "订阅").slice(0, 80),
        summary: String(s.summary || "").slice(0, 400),
        paperIds: (Array.isArray(s.paperIds) ? s.paperIds : [])
          .map(String)
          .filter((id) => idSet.has(id))
          .slice(0, 8),
      })).filter((s) => s.summary)
    : [];
  const headline = o.headline ? String(o.headline).slice(0, 200) : (brief?.slice(0, 60) || highlights[0] || undefined);
  return { headline, brief: brief || headline, highlights, themes, priorityPicks, subSpotlights: subSpotlights.length ? subSpotlights : undefined };
}

const SYS_ALL = `你是学术文献「今日证据简报」主编。用户有**多个**订阅同时命中文献；输入按「订阅」分段列出。需同时产出：
1) **brief**：扫描列表用的一段话简报（2-4句，80-220字）
2) **完整报告**：要点、主题、优先读（今日报告页用）

规则：
- 只使用给定文献，不编造；不替用户做纳入判断
- 用中文，有编辑视角
- **subSpotlights 必填**：输入里每个「## 订阅」段各一条，subLabel 与段名一致，summary 写该订阅今日核心（2句），paperIds 从该段选
- brief 必须同时概括**每一个**订阅，禁止只写最大/最近一个主题
- headline ≤60字，可略抽象；brief 比 headline 更完整
- themes / priorityPicks 应覆盖不同订阅来源
- 若摘要缺失，在 highlights 说明
- 只输出 JSON：
  brief（一段话简报，扫描列表用）
  subSpotlights（数组；每个订阅一条：subLabel、summary、paperIds）
  headline（短标题 ≤60字）
  highlights（3-5条跨订阅要点）
  themes（2-5组：title、summary、paperIds）
  priorityPicks（3-5条：paperId、reason）
不要 markdown，不要多余文字。`;

const SYS_SINGLE = `你是学术文献单主题「今日深度简报」编辑。需同时产出扫描列表用的一段话简报 + 完整深度报告。
规则：
- 只使用给定文献，不编造；不替用户做纳入判断
- 用中文，信息密度高
- brief：2-3句话（80-180字），概括该主题今日全貌（扫描列表用）
- headline：≤60字短标题
- highlights / themes / priorityPicks：完整报告用，比 brief 更细
- 只输出 JSON：
  brief（一段话简报）
  headline（短标题）
  highlights（4-6条）
  themes（3-6组：title、summary、paperIds）
  priorityPicks（4-8条：paperId、reason）
不要 markdown，不要多余文字。`;

const CAPS_ALL: ReportCaps = { highlights: 5, themes: 5, picks: 5, themePapers: 8 };
const CAPS_SINGLE: ReportCaps = { highlights: 6, themes: 6, picks: 8, themePapers: 10 };

function formatReportUserContent(inputs: DigestReportPaperInput[], scope: string): string {
  const fmtPaper = (p: DigestReportPaperInput, n: number) => {
    const tags = [p.preprint ? "预印本" : null, ...p.subLabels.map((l) => `订阅:${l}`)].filter(Boolean).join(" · ");
    const abs = p.abstract.trim() || "（无摘要，仅标题/metadata）";
    return `[${n}] id=${p.id}\n标题：${p.title}\n${tags ? "标签：" + tags + "\n" : ""}摘要：${abs}`;
  };
  if (scope === "all") {
    const byLabel = new Map<string, DigestReportPaperInput[]>();
    const labelOrder: string[] = [];
    for (const p of inputs) {
      const label = p.subLabels[0] || "订阅";
      if (!byLabel.has(label)) {
        byLabel.set(label, []);
        labelOrder.push(label);
      }
      byLabel.get(label)!.push(p);
    }
    const parts = [
      `今日共 ${inputs.length} 篇待读，来自 ${labelOrder.length} 个订阅。`,
      "请先为每个订阅写 subSpotlights，再写跨订阅的 brief 与完整报告字段。\n",
    ];
    let n = 0;
    for (const label of labelOrder) {
      const papers = byLabel.get(label)!;
      parts.push(`## 订阅「${label}」（${papers.length} 篇入模）`);
      for (const p of papers) {
        n += 1;
        parts.push(fmtPaper(p, n));
      }
      parts.push("");
    }
    return parts.join("\n");
  }
  const lines = inputs.map((p, i) => fmtPaper(p, i + 1)).join("\n\n");
  return `今日共 ${inputs.length} 篇待读：\n\n${lines}`;
}

export async function generateDigestReportContent(
  inputs: DigestReportPaperInput[],
  llm: LlmClient,
  scope: "all" | string = "all",
): Promise<Partial<DigestReport>> {
  if (!inputs.length) {
    return { brief: "今日没有待读文献。", highlights: ["今日没有待读文献。"], themes: [], priorityPicks: [], headline: "今日没有待读" };
  }
  const single = scope !== "all";
  const userContent = formatReportUserContent(inputs, scope);
  const text = await llm.complete([
    { role: "system", content: single ? SYS_SINGLE : SYS_ALL },
    { role: "user", content: userContent },
  ], { maxTokens: single ? 3800 : 3400, temperature: 0.25 });
  return parseReportJson(text || "", inputs, single ? CAPS_SINGLE : CAPS_ALL);
}

export async function runDigestReportGeneration(
  store: Store,
  llm: LlmClient,
  subs: Record<string, unknown>[],
  scope: "all" | string = "all",
  dateKey = dateKeyOf(),
): Promise<DigestReport> {
  const { inputs, subCount, unreadCount, contributingSubIds } = collectDigestReportInputs(subs, scope, dateKey);
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
    const recheck = collectDigestReportInputs(subs, scope, dateKey);
    if (!recheck.inputs.length) {
      const skipped: DigestReport = {
        ...base,
        status: "skipped",
        skippedReason: recheck.subCount === 0 ? "no_subs" : "no_unread",
        subCount: recheck.subCount,
        unreadCount: recheck.unreadCount,
        generatedAt: new Date().toISOString(),
      };
      saveDigestReport(store, skipped);
      return skipped;
    }
    const ready: DigestReport = {
      ...generating,
      status: "ready",
      model: llm.model,
      ...parsed,
      highlights: parsed.highlights || [],
      themes: parsed.themes || [],
      priorityPicks: parsed.priorityPicks || [],
      contributingSubIds: scope === "all" ? contributingSubIds : undefined,
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
