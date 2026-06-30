// 订阅 · 回顾视图（digest_retro 补丁）
// 三块：① 关于你的图表（feed 体量 + 主题构成随时间，确定性）② 跨时间窗 AI 回顾（接地 + paper 锚点）③ 历史每日简报浏览。
// 诚实横幅贯穿全程：这些都关于「你的订阅 feed」，样本有偏，非领域统计 / 非系统综述。
import React, { useState, useEffect, useCallback } from "react";
import { bridge } from "../lumina-bridge.js";
import { Loader, Sparkles, AlertTriangle, RefreshCw, ChevronLeft, ArrowRight, Clock, Inbox, Calendar } from "lucide-react";
import { RetroVolumeChart, RetroTopicChart, RetroTopicLegend } from "./RetroChart.jsx";
import { DigestReportReader } from "./DigestReportHero.jsx";

const FRAMING = "本回顾基于你的订阅收到的论文 —— 是你的 feed 捞取记录，样本有偏（受你订阅了什么、订阅多久、去重影响），不是该领域的发表统计或系统综述。";

const RANGES = [
  { key: 7, label: "近 7 天" },
  { key: 30, label: "近 30 天" },
  { key: 90, label: "近 90 天" },
  { key: 365, label: "近 1 年" },
  { key: 0, label: "全部" },
];
const GRANS = [
  { key: "day", label: "按天" },
  { key: "week", label: "按周" },
  { key: "month", label: "按月" },
];

function FramingBanner() {
  return (
    <div className="rt-framing" role="note">
      <AlertTriangle size={13} />
      <span>{FRAMING}</span>
    </div>
  );
}

function Seg({ items, value, onChange, ariaLabel }) {
  return (
    <div className="rt-seg" role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={String(it.key)}
          type="button"
          role="tab"
          aria-selected={value === it.key}
          className={value === it.key ? "on" : ""}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function PaperRefs({ refs, titles, onJump }) {
  if (!refs || refs.length === 0) return null;
  return (
    <div className="rt-refs">
      {refs.map((id) => (
        <button key={id} type="button" className="rt-ref" title={titles[id] || "跳转到该文献"} onClick={() => onJump && onJump(id)}>
          <span className="rt-ref-t">{titles[id] || "跳转文献"}</span>
          <ArrowRight size={11} />
        </button>
      ))}
    </div>
  );
}

function AnalysisBlock({ analysis, titles, onJump }) {
  if (!analysis) return null;
  if (analysis.status === "empty") {
    return <div className="rt-ai-state"><Inbox size={20} /><p>这个范围内还没有足够的历史可回顾。继续让订阅运行，攒够几天再来看。</p></div>;
  }
  if (analysis.status === "failed") {
    return <div className="rt-ai-state warn"><AlertTriangle size={20} /><p>回顾生成失败{analysis.error ? `（${analysis.error}）` : ""} · 可重试，或在设置中换更稳的模型。</p></div>;
  }
  if (analysis.status !== "ready") return null;
  return (
    <div className="rt-ai-result">
      <div className="rt-ai-infer"><Sparkles size={12} /> AI 推断 · 关于你的订阅 · 由你判断</div>
      {analysis.headline && <p className="rt-ai-headline">{analysis.headline}</p>}
      <p className="rt-ai-meta">覆盖 {analysis.paperCount} 篇 · {analysis.windowCount} 个时间窗 · {analysis.rangeLabel}{analysis.model ? ` · ${analysis.model}` : ""}</p>

      {analysis.shifts && analysis.shifts.length > 0 && (
        <section className="rt-ai-sec">
          <div className="rt-ai-eyebrow">你的 feed 里的变化</div>
          <ul className="rt-ai-shifts">
            {analysis.shifts.map((s, i) => (
              <li key={i}>
                <span className="rt-ai-shift-t">{s.change}</span>
                <PaperRefs refs={s.paperRefs} titles={titles} onJump={onJump} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.windows && analysis.windows.length > 0 && (
        <section className="rt-ai-sec">
          <div className="rt-ai-eyebrow">逐窗回顾</div>
          <div className="rt-ai-windows">
            {analysis.windows.map((w, i) => (
              <article key={i} className="rt-ai-window">
                <h4 className="rt-ai-window-t">{w.label}{w.dateFrom ? <span className="rt-ai-window-d">{w.dateFrom} → {w.dateTo}</span> : null}</h4>
                <p className="rt-ai-window-g">{w.gist}</p>
                <PaperRefs refs={w.paperRefs} titles={titles} onJump={onJump} />
              </article>
            ))}
          </div>
        </section>
      )}

      {analysis.caveats && analysis.caveats.length > 0 && (
        <div className="rt-ai-caveats">
          {analysis.caveats.map((c, i) => <span key={i} className="rt-ai-caveat">{c}</span>)}
        </div>
      )}
    </div>
  );
}

function DayList({ dates, selected, onSelect }) {
  if (!dates || dates.length === 0) return null;
  return (
    <div className="rt-daylist">
      {dates.map((d) => (
        <button
          key={d.dateKey}
          type="button"
          className={"rt-dayitem" + (selected === d.dateKey ? " on" : "")}
          onClick={() => onSelect(d.dateKey)}
        >
          <Calendar size={13} />
          <span className="rt-day-k">{d.dateKey}</span>
          <span className="rt-day-c">{d.paperCount} 篇</span>
          {d.hasReport && <Sparkles size={11} className="rt-day-rep" />}
        </button>
      ))}
    </div>
  );
}

function DayPaperList({ papers, onJump }) {
  if (!papers || papers.length === 0) return null;
  return (
    <div className="rt-daypapers">
      <div className="rt-daypapers-h">当天进入你 feed 的文献（{papers.length}）</div>
      {papers.map((p) => (
        <button key={p.id} type="button" className="rt-daypaper" onClick={() => onJump && onJump(p.id)} title="跳转到该文献">
          <span className="rt-daypaper-t">{p.title || p.id}</span>
          {p.preprint && <span className="rt-daypaper-pp">预印本</span>}
          {p.year ? <span className="rt-daypaper-y">{p.year}</span> : null}
          <ArrowRight size={12} />
        </button>
      ))}
    </div>
  );
}

export default function DigestRetro({ scope = "all", scopeLabel = "全部订阅", onJumpPaper, onBackToScan, onOpenSettings }) {
  const [pane, setPane] = useState("charts"); // charts | history
  const [dates, setDates] = useState(null); // null=loading
  const [range, setRange] = useState(90);
  const [gran, setGran] = useState("week");
  const [series, setSeries] = useState(null);
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisTitles, setAnalysisTitles] = useState({});
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [selDate, setSelDate] = useState("");
  const [dayReport, setDayReport] = useState(null);
  const [dayPapers, setDayPapers] = useState([]);
  const [dayBusy, setDayBusy] = useState(false);

  const jump = useCallback((id) => onJumpPaper && onJumpPaper(id), [onJumpPaper]);

  // 历史日期
  useEffect(() => {
    let alive = true;
    setDates(null);
    bridge.digestHistoryDates(scope).then((r) => {
      if (!alive) return;
      setDates(r && r.ok && Array.isArray(r.dates) ? r.dates : []);
    }).catch(() => { if (alive) setDates([]); });
    return () => { alive = false; };
  }, [scope]);

  // 确定性序列
  useEffect(() => {
    let alive = true;
    setSeriesBusy(true);
    bridge.digestRetroSeries({ scope, granularity: gran, sinceDays: range }).then((r) => {
      if (!alive) return;
      setSeries(r && r.volume ? r : null);
    }).catch(() => { if (alive) setSeries(null); }).finally(() => { if (alive) setSeriesBusy(false); });
    return () => { alive = false; };
  }, [scope, gran, range]);

  // 切范围清空旧 AI 回顾
  useEffect(() => { setAnalysis(null); setAnalysisTitles({}); }, [scope, range]);

  const runAnalysis = useCallback(async () => {
    setAnalysisBusy(true);
    try {
      const r = await bridge.digestRetroAnalyze({ scope, sinceDays: range });
      setAnalysis(r && r.analysis ? r.analysis : (r && r.ok === false ? { status: "failed", error: r.error } : null));
      setAnalysisTitles(r && r.titles ? r.titles : {});
    } catch {
      setAnalysis({ status: "failed", error: "request_failed" });
    } finally {
      setAnalysisBusy(false);
    }
  }, [scope, range]);

  const openDay = useCallback(async (dateKey) => {
    setSelDate(dateKey);
    setDayBusy(true);
    try {
      const r = await bridge.digestHistoryGet(dateKey, scope);
      setDayReport(r && r.report ? r.report : null);
      setDayPapers(r && Array.isArray(r.papers) ? r.papers : []);
    } catch {
      setDayReport(null);
      setDayPapers([]);
    } finally {
      setDayBusy(false);
    }
  }, [scope]);

  const hasHistory = Array.isArray(dates) && dates.length > 0;

  return (
    <div className="rt-root">
      <div className="rt-topbar">
        <button type="button" className="rt-back" onClick={onBackToScan}><ChevronLeft size={15} /> 扫描列表</button>
        <span className="rt-scope">{scopeLabel} · 回顾</span>
        <div className="rt-pane-seg">
          <Seg
            items={[{ key: "charts", label: "图表回顾" }, { key: "history", label: "历史每日" }]}
            value={pane}
            onChange={setPane}
            ariaLabel="回顾视图"
          />
        </div>
      </div>

      <FramingBanner />

      {dates === null ? (
        <div className="rt-loading"><Loader size={22} className="dg-spin" /><p>读取历史…</p></div>
      ) : !hasHistory ? (
        <div className="rt-empty">
          <Clock size={28} strokeWidth={1.6} />
          <h3>还没有可回顾的历史</h3>
          <p>订阅每天运行后，会把「你的 feed 当天收到了哪些」攒成历史。攒够几天，这里就能看你订阅随时间的体量、主题构成与 AI 回顾。</p>
        </div>
      ) : pane === "charts" ? (
        <div className="rt-charts">
          <div className="rt-controls">
            <Seg items={RANGES} value={range} onChange={setRange} ariaLabel="时间范围" />
            <Seg items={GRANS} value={gran} onChange={setGran} ariaLabel="时间粒度" />
          </div>

          <section className="rt-card">
            <div className="rt-card-h"><span className="rt-card-t">你的 feed 体量</span><span className="rt-card-s">每{gran === "day" ? "天" : gran === "week" ? "周" : "月"}进入你订阅的论文数</span></div>
            {seriesBusy ? (
              <div className="rt-chart-empty"><Loader size={18} className="dg-spin" /> 计算中…</div>
            ) : (
              <RetroVolumeChart buckets={series ? series.volume : []} />
            )}
          </section>

          <section className="rt-card">
            <div className="rt-card-h">
              <span className="rt-card-t">你的主题构成随时间</span>
              <span className="rt-card-s">基于命中论文的{series && series.topicDim === "studyType" ? "研究类型" : "关键词/主题词"}</span>
            </div>
            {seriesBusy ? (
              <div className="rt-chart-empty"><Loader size={18} className="dg-spin" /> 计算中…</div>
            ) : (
              <>
                <RetroTopicChart topicSeries={series ? series.topicSeries : null} />
                <RetroTopicLegend topicSeries={series ? series.topicSeries : null} />
              </>
            )}
          </section>

          <section className="rt-card rt-ai-card">
            <div className="rt-card-h">
              <span className="rt-card-t"><Sparkles size={14} /> AI 回顾</span>
              <button type="button" className="rt-ai-btn" disabled={analysisBusy} onClick={runAnalysis}>
                {analysisBusy ? <><Loader size={13} className="dg-spin" /> 回顾中…</> : <><RefreshCw size={13} /> {analysis ? "重新回顾" : "生成回顾"}</>}
              </button>
            </div>
            <p className="rt-ai-hint">AI 会把你这段时间的订阅按时间窗整理，复用每天已生成的简报、跨窗比较你 feed 的变化（不是领域趋势）。每条尽量挂到具体论文。</p>
            {analysisBusy && !analysis ? (
              <div className="rt-ai-state"><Loader size={20} className="dg-spin" /><p>正在回顾你 {analysis ? "" : ""}这段时间的订阅…</p></div>
            ) : (
              <AnalysisBlock analysis={analysis} titles={analysisTitles} onJump={jump} />
            )}
          </section>
        </div>
      ) : (
        <div className="rt-history">
          <DayList dates={dates} selected={selDate} onSelect={openDay} />
          <div className="rt-day-detail">
            {!selDate ? (
              <div className="rt-day-hint"><Calendar size={24} strokeWidth={1.6} /><p>选左侧某一天，回看那天的简报报告与进入你 feed 的文献。</p></div>
            ) : dayBusy ? (
              <div className="rt-loading"><Loader size={20} className="dg-spin" /><p>读取 {selDate}…</p></div>
            ) : (
              <>
                {dayReport && dayReport.status === "ready" ? (
                  <DigestReportReader
                    report={dayReport}
                    onJumpPaper={jump}
                    onBackToScan={() => setSelDate("")}
                    onGenerate={null}
                    generating={false}
                    paperTitleById={Object.fromEntries(dayPapers.map((p) => [p.id, p.title || ""]))}
                    scopeMode={scope === "all" ? "all" : "single"}
                    scopeLabel={`${selDate} · ${scopeLabel}`}
                    onOpenSettings={onOpenSettings}
                  />
                ) : (
                  <div className="rt-day-noreport"><Sparkles size={18} /><p>这天没有已生成的简报报告（可能当天未开应用或未配模型）。下面是当天进入你 feed 的文献。</p></div>
                )}
                <DayPaperList papers={dayPapers} onJump={jump} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
