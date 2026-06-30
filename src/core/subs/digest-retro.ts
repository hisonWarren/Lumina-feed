// 订阅简报 · 回顾分析（digest_retro 补丁）
// 两件事：
//   1) buildRetroSeries —— 纯确定性计数，喂「关于你的」图表（feed 体量随时间 + 主题构成随时间）。无 LLM。
//   2) generateRetroAnalysis —— 分层 AI 回顾：按时间窗切片 → 复用已存的每日 digest_report（本就是接地摘要）作窗口输入
//      → 跨窗口比较，绕开单次 8 篇上限。口径锁死「在你这条订阅收到的 N 篇中…」，**禁止**输出「该领域转向」。
// 红线（接地诚实）：所有图与文都关于「你的订阅 feed」，样本有偏，非系统综述 / 非领域统计。
import type { Store } from "../store/index.ts";
import type { LlmClient } from "../summarize/types.ts";
import { listSnapshotDates, loadSnapshot, dateKeyToMs } from "./digest-archive.ts";
import { digestReportStorageKey, type DigestReport } from "./digest-report.ts";

export type RetroGranularity = "day" | "week" | "month";

export const RETRO_FRAMING =
  "本回顾基于你的订阅收到的论文，样本有偏（受你订阅了什么、订阅了多久、去重行为影响），不是该领域的系统综述或发表统计。";

// ── 时间桶 ──

function startOfWeekMs(ms: number): number {
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketKeyOf(dateKey: string, g: RetroGranularity): { key: string; label: string } {
  const ms = dateKeyToMs(dateKey);
  if (!Number.isFinite(ms)) return { key: dateKey, label: dateKey };
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (g === "month") return { key: `${y}-${m}`, label: `${y}-${m}` };
  if (g === "week") {
    const ws = new Date(startOfWeekMs(ms));
    const we = new Date(ws.getTime());
    we.setDate(we.getDate() + 6);
    const wm = String(ws.getMonth() + 1).padStart(2, "0");
    const wd = String(ws.getDate()).padStart(2, "0");
    const weM = String(we.getMonth() + 1).padStart(2, "0");
    const weD = String(we.getDate()).padStart(2, "0");
    return { key: `${ws.getFullYear()}-W${wm}${wd}`, label: `${wm}/${wd}–${weM}/${weD}` };
  }
  return { key: `${y}-${m}-${day}`, label: `${m}/${day}` };
}

const STUDY_TYPE_LABEL: Record<string, string> = {
  other: "其他类型",
  preprint: "预印本",
  review: "综述",
  editorial: "社论",
  meta: "荟萃分析",
  trial: "临床试验",
  observational: "观察性研究",
  basic: "基础研究",
};

function displayTopicLabel(token: string, raw: string, topicDim: "topic" | "studyType"): string {
  if (topicDim === "studyType") return STUDY_TYPE_LABEL[token.toLowerCase()] || raw;
  return raw;
}

interface PaperMeta {
  id: string;
  title: string;
  pubYear?: number;
  studyTypes: string[];
  topics: string[]; // keywords ∪ mesh，小写去重
}

function parseJsonArr(s: unknown): string[] {
  if (typeof s !== "string" || !s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function fetchPaperMeta(store: Store, ids: string[]): Map<string, PaperMeta> {
  const out = new Map<string, PaperMeta>();
  if (!ids.length) return out;
  const uniq = [...new Set(ids.map(String))];
  const CHUNK = 400;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK);
    const ph = slice.map(() => "?").join(",");
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = store.db
        .prepare(`SELECT id, title, year, study_types_json, primary_type, mesh_json, keywords_json FROM papers WHERE id IN (${ph})`)
        .all(...slice) as Array<Record<string, unknown>>;
    } catch {
      rows = [];
    }
    for (const r of rows) {
      const studyTypes = parseJsonArr(r.study_types_json);
      if (!studyTypes.length && r.primary_type) studyTypes.push(String(r.primary_type));
      const kw = parseJsonArr(r.keywords_json);
      const mesh = parseJsonArr(r.mesh_json);
      const topicSet = new Set<string>();
      const topics: string[] = [];
      for (const t of [...kw, ...mesh]) {
        const norm = t.trim().toLowerCase();
        if (norm && norm.length <= 60 && !topicSet.has(norm)) {
          topicSet.add(norm);
          topics.push(t.trim());
        }
      }
      out.set(String(r.id), {
        id: String(r.id),
        title: String(r.title || ""),
        pubYear: r.year != null ? Number(r.year) : undefined,
        studyTypes,
        topics,
      });
    }
  }
  return out;
}

// ── 1) 确定性序列（图表数据） ──

export interface RetroBucket {
  key: string;
  label: string;
  count: number; // 该桶进入你 feed 的论文数（跨订阅去重）
}

export interface RetroTopicSeries {
  topics: string[]; // 全程 top-N 主题词
  buckets: Array<{ key: string; label: string; counts: number[]; other: number }>;
}

export interface RetroSeries {
  scope: "all" | string;
  granularity: RetroGranularity;
  framing: string;
  span: { from: string; to: string } | null;
  totalPapers: number;
  bucketsWithData: number;
  volume: RetroBucket[];
  topicSeries: RetroTopicSeries;
  topicDim: "topic" | "studyType";
}

export interface RetroSeriesOpts {
  scope?: "all" | string;
  granularity?: RetroGranularity;
  sinceDays?: number; // 仅取最近 N 天；省略 = 全部历史
  topN?: number; // 主题维度取前 N（默认 6）
}

export function buildRetroSeries(store: Store, opts: RetroSeriesOpts = {}): RetroSeries {
  const scope = opts.scope || "all";
  const granularity: RetroGranularity = opts.granularity || "week";
  const topN = Math.min(Math.max(opts.topN ?? 6, 3), 10);
  const empty: RetroSeries = {
    scope,
    granularity,
    framing: RETRO_FRAMING,
    span: null,
    totalPapers: 0,
    bucketsWithData: 0,
    volume: [],
    topicSeries: { topics: [], buckets: [] },
    topicDim: "topic",
  };

  const subId = scope === "all" ? undefined : scope;
  let dates = listSnapshotDates(store, subId).map((r) => r.dateKey);
  if (!dates.length) return empty;
  if (opts.sinceDays && opts.sinceDays > 0) {
    const cutoff = Date.now() - opts.sinceDays * 24 * 3600 * 1000;
    dates = dates.filter((dk) => {
      const t = dateKeyToMs(dk);
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  if (!dates.length) return empty;
  dates.sort(); // 升序

  // 收集每天 paperIds（跨订阅去重）+ 全量 id 池
  const perDate = new Map<string, string[]>();
  const allIds = new Set<string>();
  for (const dk of dates) {
    const snap = loadSnapshot(store, dk, subId);
    perDate.set(dk, snap.paperIds);
    for (const id of snap.paperIds) allIds.add(id);
  }
  const meta = fetchPaperMeta(store, [...allIds]);

  // 主题维度：优先 keywords∪mesh；若覆盖太稀疏（<20% 论文有 topic）退回 studyTypes
  const withTopic = [...allIds].filter((id) => (meta.get(id)?.topics.length || 0) > 0).length;
  const topicDim: "topic" | "studyType" = withTopic >= Math.max(3, allIds.size * 0.2) ? "topic" : "studyType";
  const tokensOf = (id: string): string[] => {
    const m = meta.get(id);
    if (!m) return [];
    return topicDim === "topic" ? m.topics : m.studyTypes;
  };

  // 全程 top-N 主题
  const freq = new Map<string, number>();
  for (const id of allIds) {
    for (const tk of new Set(tokensOf(id).map((t) => t.toLowerCase()))) {
      freq.set(tk, (freq.get(tk) || 0) + 1);
    }
  }
  const topTokens = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([t]) => t);
  const topLabelByLower = new Map<string, string>();
  for (const id of allIds) {
    for (const tk of tokensOf(id)) {
      const low = tk.toLowerCase();
      if (topTokens.includes(low) && !topLabelByLower.has(low)) topLabelByLower.set(low, tk);
    }
  }
  const topics = topTokens.map((t) => displayTopicLabel(t, topLabelByLower.get(t) || t, topicDim));

  // 按桶聚合
  const volMap = new Map<string, { label: string; count: number }>();
  const topicBucketMap = new Map<string, { label: string; counts: number[]; other: number }>();
  const orderedKeys: string[] = [];
  for (const dk of dates) {
    const { key, label } = bucketKeyOf(dk, granularity);
    if (!volMap.has(key)) {
      volMap.set(key, { label, count: 0 });
      topicBucketMap.set(key, { label, counts: new Array(topTokens.length).fill(0), other: 0 });
      orderedKeys.push(key);
    }
    const ids = perDate.get(dk) || [];
    const v = volMap.get(key)!;
    v.count += ids.length;
    const tb = topicBucketMap.get(key)!;
    for (const id of ids) {
      const lows = new Set(tokensOf(id).map((t) => t.toLowerCase()));
      let matched = false;
      topTokens.forEach((tk, idx) => {
        if (lows.has(tk)) {
          tb.counts[idx] += 1;
          matched = true;
        }
      });
      if (!matched) tb.other += 1;
    }
  }

  const volume: RetroBucket[] = orderedKeys.map((k) => ({ key: k, label: volMap.get(k)!.label, count: volMap.get(k)!.count }));
  const topicSeries: RetroTopicSeries = {
    topics,
    buckets: orderedKeys.map((k) => {
      const tb = topicBucketMap.get(k)!;
      return { key: k, label: tb.label, counts: tb.counts, other: tb.other };
    }),
  };

  return {
    scope,
    granularity,
    framing: RETRO_FRAMING,
    span: { from: dates[0], to: dates[dates.length - 1] },
    totalPapers: allIds.size,
    bucketsWithData: orderedKeys.length,
    volume,
    topicSeries,
    topicDim,
  };
}

// ── 2) 分层 AI 回顾 ──

export interface RetroWindow {
  label: string;
  dateFrom: string;
  dateTo: string;
  gist: string;
  paperRefs: string[]; // 该窗口代表性论文 id（可点跳）
}

export interface RetroShift {
  change: string; // 「你的 feed 中 X 减少 / Y 增多」式表述
  paperRefs: string[];
}

export interface RetroAnalysis {
  scope: "all" | string;
  status: "ready" | "skipped" | "failed" | "empty";
  framing: string;
  headline?: string;
  rangeLabel: string;
  windows: RetroWindow[];
  shifts: RetroShift[];
  caveats: string[];
  model?: string;
  generatedAt?: string;
  skippedReason?: string;
  error?: string;
  paperCount: number;
  windowCount: number;
}

export function retroCacheKey(scope: string, sinceDays: number, granularity: RetroGranularity): string {
  return `digest_retro:${scope}:${sinceDays || 0}:${granularity}`;
}

function emptyAnalysis(scope: "all" | string, rangeLabel: string): RetroAnalysis {
  return {
    scope,
    status: "empty",
    framing: RETRO_FRAMING,
    rangeLabel,
    windows: [],
    shifts: [],
    caveats: [],
    paperCount: 0,
    windowCount: 0,
  };
}

/** 把历史日期按窗口（默认 month）切片，每窗复用已存每日报告作输入；缺报告则用论文标题兜底 */
function buildWindowInputs(
  store: Store,
  dates: string[],
  subId: string | undefined,
  windowGranularity: RetroGranularity,
  maxWindows: number,
): Array<{ label: string; dateFrom: string; dateTo: string; daily: string[]; titles: Array<{ id: string; title: string }>; ids: string[] }> {
  const byWindow = new Map<string, { label: string; dks: string[] }>();
  const order: string[] = [];
  for (const dk of dates) {
    const { key, label } = bucketKeyOf(dk, windowGranularity);
    if (!byWindow.has(key)) {
      byWindow.set(key, { label, dks: [] });
      order.push(key);
    }
    byWindow.get(key)!.dks.push(dk);
  }
  // 仅保留最近 maxWindows 个窗口（order 是升序，取末尾）
  const kept = order.slice(-maxWindows);
  const result: Array<{ label: string; dateFrom: string; dateTo: string; daily: string[]; titles: Array<{ id: string; title: string }>; ids: string[] }> = [];
  for (const key of kept) {
    const w = byWindow.get(key)!;
    const dks = [...w.dks].sort();
    const daily: string[] = [];
    const ids: string[] = [];
    const idSeen = new Set<string>();
    for (const dk of dks) {
      // 复用已存每日总报告（已是接地摘要）
      try {
        const r = store.db
          .prepare("SELECT payload FROM sources_cache WHERE key=?")
          .get(digestReportStorageKey(dk, "all")) as { payload?: string } | undefined;
        if (r?.payload) {
          const rep = JSON.parse(r.payload) as DigestReport;
          if (rep.status === "ready") {
            const parts: string[] = [];
            if (rep.headline) parts.push(rep.headline);
            for (const h of rep.highlights || []) parts.push(h);
            for (const t of rep.themes || []) parts.push(`${t.title}：${t.summary}`);
            if (parts.length) daily.push(`【${dk}】` + parts.join("；"));
          }
        }
      } catch {
        /* ignore */
      }
      const snap = loadSnapshot(store, dk, subId);
      for (const id of snap.paperIds) {
        if (!idSeen.has(id)) {
          idSeen.add(id);
          ids.push(id);
        }
      }
    }
    const metaMap = fetchPaperMeta(store, ids);
    const titles = ids.slice(0, 24).map((id) => ({ id, title: metaMap.get(id)?.title || "(无标题)" }));
    result.push({ label: w.label, dateFrom: dks[0], dateTo: dks[dks.length - 1], daily, titles, ids });
  }
  return result;
}

const RETRO_SYS = `你是用户个人文献「订阅回顾」助手。下面是用户**某一订阅 / 全部订阅**在过去一段时间里、按时间窗整理的「每日简报摘要」与论文标题。请帮用户回顾**他自己的 feed 在这段时间里的变化**。
铁律（违反即失败）：
- 这是「关于用户订阅 feed」的回顾，**不是**领域综述。**禁止**出现「该领域转向/学界趋势/研究热点整体」等把样本当全域的措辞。
- 一律用「你的订阅中…」「这段时间你 feed 里…出现/增多/减少」式表述。
- 只用给定信息，不编造；样本有偏要点出。每条变化尽量挂具体论文 id（paperRefs）。
- 用中文，简洁、有回顾视角。
- 只输出一个 JSON 对象，字段：
  headline（一句话，≤50字，概括你这段时间订阅的整体走向，须是「你的 feed」口径）
  windows（数组，每个时间窗一项：{label, gist（1-2句，这一窗你 feed 里主要是什么），paperRefs（该窗代表性论文 id 数组）}）
  shifts（数组，2-4条跨窗变化：{change（「你的 feed 中 X 减少、Y 增多」式，1句），paperRefs}）
  caveats（数组，1-3条提醒，如样本量小 / 订阅时间短 / 某窗缺数据）
不要 markdown，不要多余文字。`;

function parseRetroJson(raw: string, validIds: Set<string>): Partial<RetroAnalysis> {
  const trimmed = (raw || "").trim();
  let obj: Record<string, unknown> | null = null;
  try {
    const s = trimmed.indexOf("{");
    const e = trimmed.lastIndexOf("}");
    obj = JSON.parse(trimmed.slice(s >= 0 ? s : 0, e >= 0 ? e + 1 : trimmed.length)) as Record<string, unknown>;
  } catch {
    return { caveats: ["回顾结果结构不完整（可能被模型截断），请重试或换用上下文更长的模型。"] };
  }
  const o = obj || {};
  const refs = (arr: unknown): string[] =>
    (Array.isArray(arr) ? arr : []).map(String).filter((id) => validIds.has(id)).slice(0, 8);
  const windows: RetroWindow[] = Array.isArray(o.windows)
    ? (o.windows as Array<Record<string, unknown>>).slice(0, 12).map((w) => ({
        label: String(w.label || "").slice(0, 40),
        dateFrom: "",
        dateTo: "",
        gist: String(w.gist || "").slice(0, 400),
        paperRefs: refs(w.paperRefs),
      })).filter((w) => w.gist)
    : [];
  const shifts: RetroShift[] = Array.isArray(o.shifts)
    ? (o.shifts as Array<Record<string, unknown>>).slice(0, 6).map((s) => ({
        change: String(s.change || "").slice(0, 280),
        paperRefs: refs(s.paperRefs),
      })).filter((s) => s.change)
    : [];
  const caveats: string[] = Array.isArray(o.caveats)
    ? (o.caveats as unknown[]).map((c) => String(c).slice(0, 200)).filter(Boolean).slice(0, 4)
    : [];
  const headline = o.headline ? String(o.headline).slice(0, 120) : undefined;
  return { headline, windows, shifts, caveats };
}

export interface RetroAnalysisOpts {
  scope?: "all" | string;
  sinceDays?: number;
  windowGranularity?: RetroGranularity;
  maxWindows?: number;
}

export async function generateRetroAnalysis(
  store: Store,
  llm: LlmClient,
  opts: RetroAnalysisOpts = {},
): Promise<RetroAnalysis> {
  const scope = opts.scope || "all";
  const sinceDays = opts.sinceDays && opts.sinceDays > 0 ? opts.sinceDays : 0;
  const windowGranularity: RetroGranularity = opts.windowGranularity || "month";
  const maxWindows = Math.min(Math.max(opts.maxWindows ?? 6, 2), 8);
  const rangeLabel = sinceDays ? `最近 ${sinceDays} 天` : "全部历史";

  const subId = scope === "all" ? undefined : scope;
  let dates = listSnapshotDates(store, subId).map((r) => r.dateKey);
  if (sinceDays) {
    const cutoff = Date.now() - sinceDays * 24 * 3600 * 1000;
    dates = dates.filter((dk) => {
      const t = dateKeyToMs(dk);
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  dates.sort();
  if (!dates.length) return emptyAnalysis(scope, rangeLabel);

  const windowsIn = buildWindowInputs(store, dates, subId, windowGranularity, maxWindows);
  const allIds = new Set<string>();
  for (const w of windowsIn) for (const id of w.ids) allIds.add(id);
  if (!allIds.size) return emptyAnalysis(scope, rangeLabel);

  // 组装 prompt：每窗给 daily 摘要（已接地）+ 标题清单
  const blocks = windowsIn.map((w, i) => {
    const dailyTxt = w.daily.length ? w.daily.join("\n") : "（该窗无已生成的每日报告，仅列标题）";
    const titleTxt = w.titles.map((t) => `  - id=${t.id} ${t.title}`).join("\n");
    return `== 时间窗 ${i + 1}：${w.label}（${w.dateFrom}→${w.dateTo}，${w.ids.length} 篇）==\n[每日简报摘要]\n${dailyTxt}\n[论文标题]\n${titleTxt}`;
  });
  const userMsg = `范围：${scope === "all" ? "全部订阅" : "单个订阅"} · ${rangeLabel} · 共 ${allIds.size} 篇、${windowsIn.length} 个时间窗。\n\n${blocks.join("\n\n")}`;

  let text = "";
  try {
    text = await llm.complete(
      [
        { role: "system", content: RETRO_SYS },
        { role: "user", content: userMsg },
      ],
      { maxTokens: 2600, temperature: 0.3 },
    );
  } catch (e) {
    return {
      ...emptyAnalysis(scope, rangeLabel),
      status: "failed",
      error: (e && (e as Error).message) || "retro_failed",
      paperCount: allIds.size,
      windowCount: windowsIn.length,
    };
  }

  const parsed = parseRetroJson(text || "", allIds);
  // 回填每窗 dateFrom/dateTo（按 label 匹配）
  const byLabel = new Map(windowsIn.map((w) => [w.label, w]));
  const windows = (parsed.windows || []).map((w) => {
    const src = byLabel.get(w.label);
    return src ? { ...w, dateFrom: src.dateFrom, dateTo: src.dateTo } : w;
  });

  return {
    scope,
    status: "ready",
    framing: RETRO_FRAMING,
    headline: parsed.headline,
    rangeLabel,
    windows,
    shifts: parsed.shifts || [],
    caveats: parsed.caveats || [],
    model: llm.model,
    generatedAt: new Date().toISOString(),
    paperCount: allIds.size,
    windowCount: windowsIn.length,
  };
}
