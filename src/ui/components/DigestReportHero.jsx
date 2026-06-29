// 简报 · 今日总报告 Hero（五段式 · 可折叠）
import React from "react";
import { ChevronDown, ChevronUp, Loader, RefreshCw, Settings, Sparkles, AlertTriangle } from "lucide-react";

const DISCLAIMER = "推断 · 基于标题与摘要 · 是否纳入由你判断";

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "刚刚生成";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前生成`;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " 生成";
  } catch { return ""; }
}

export default function DigestReportHero({
  report,
  collapsed,
  onToggleCollapse,
  onGenerate,
  generating,
  onOpenSettings,
  onJumpPaper,
  onViewReport,
  viewMode,
}) {
  const status = report?.status || "idle";
  const ready = status === "ready";
  const busy = generating || status === "generating";

  return (
    <section className={"dg-report-hero" + (collapsed ? " collapsed" : "")}>
      <div className="dg-report-head">
        <button type="button" className="dg-report-collapse" onClick={onToggleCollapse} aria-expanded={!collapsed}>
          <Sparkles size={16} />
          <span className="dg-report-title">今日简报报告</span>
          {ready && report.headline && collapsed && <span className="dg-report-headline">{report.headline}</span>}
          {busy && <span className="dg-report-busy"><Loader size={13} className="rd-spin" /> 撰写中…</span>}
          {ready && !collapsed && <span className="dg-report-meta">{fmtTime(report.generatedAt)}</span>}
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <div className="dg-report-actions">
          {viewMode !== "report" && ready && (
            <button type="button" className="dg-report-btn" onClick={onViewReport}>阅读报告</button>
          )}
          <button type="button" className="dg-report-btn" disabled={busy} onClick={() => onGenerate(true)}>
            {busy ? <><Loader size={13} className="rd-spin" /> 生成中</> : <><RefreshCw size={13} /> {ready ? "刷新" : "生成报告"}</>}
          </button>
          <button type="button" className="dg-report-icon" title="简报报告设置" onClick={onOpenSettings}><Settings size={15} /></button>
        </div>
      </div>

      {!collapsed && (
        <div className="dg-report-body">
          <p className="dg-report-disclaimer">{DISCLAIMER}</p>

          {status === "skipped" && report.skippedReason === "llm_not_configured" && (
            <div className="dg-report-note"><AlertTriangle size={14} /> 未配置大模型 · 请在设置中填写 API Key 后生成报告</div>
          )}
          {status === "skipped" && report.skippedReason === "auto_off" && !ready && (
            <div className="dg-report-note">自动生成已关闭 · 点击「生成报告」手动撰写，或在设置中开启</div>
          )}
          {status === "failed" && (
            <div className="dg-report-note"><AlertTriangle size={14} /> 报告生成失败{report.error ? `（${report.error}）` : ""} · 请重试</div>
          )}
          {busy && !ready && (
            <div className="dg-report-note"><Loader size={14} className="rd-spin" /> 正在归纳 {report?.paperCount || "…"} 篇待读… 列表可先浏览</div>
          )}

          {ready && (
            <>
              {report.headline && <p className="dg-report-lead">{report.headline}</p>}
              {Array.isArray(report.highlights) && report.highlights.length > 0 && (
                <div className="dg-report-block">
                  <h3>今日要点</h3>
                  <ul>{report.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
                </div>
              )}
              {Array.isArray(report.themes) && report.themes.length > 0 && (
                <div className="dg-report-block">
                  <h3>主题分组</h3>
                  {report.themes.map((t, i) => (
                    <div key={i} className="dg-report-theme">
                      <strong>{t.title}</strong>
                      <p>{t.summary}</p>
                      {t.paperIds?.length > 0 && (
                        <div className="dg-report-links">
                          {t.paperIds.slice(0, 4).map((id) => (
                            <button key={id} type="button" className="dg-report-link" onClick={() => onJumpPaper(id)}>跳转文献</button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(report.priorityPicks) && report.priorityPicks.length > 0 && (
                <div className="dg-report-block">
                  <h3>值得优先看</h3>
                  <ol className="dg-report-picks">
                    {report.priorityPicks.map((p) => (
                      <li key={p.paperId}>
                        <button type="button" className="dg-report-pick-t" onClick={() => onJumpPaper(p.paperId)}>{p.title || p.paperId}</button>
                        <span className="dg-report-pick-r">{p.reason}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="dg-report-foot">
                覆盖 {report.paperCount} 篇 · {report.subCount} 个订阅
                {report.model ? ` · ${report.model}` : ""}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function DigestReportReader({ report, onJumpPaper, onBackToScan, onGenerate, generating }) {
  const busy = generating || report?.status === "generating";
  if (!report || (report.status !== "ready" && !busy)) {
    return (
      <div className="dg-report-reader dg-empty">
        <p>{report?.skippedReason === "llm_not_configured" ? "未配置大模型 · 请在设置中填写 API Key" : "报告尚未就绪"}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" className="dg-report-btn" onClick={onBackToScan}>返回扫描列表</button>
          {onGenerate && <button type="button" className="dg-report-btn" disabled={busy} onClick={() => onGenerate(true)}>{busy ? "生成中…" : "生成报告"}</button>}
        </div>
      </div>
    );
  }
  if (busy && report.status !== "ready") {
    return (
      <div className="dg-report-reader dg-empty">
        <Loader size={22} className="rd-spin" />
        <p>正在撰写今日简报报告…</p>
        <button type="button" className="dg-report-btn" onClick={onBackToScan}>先浏览扫描列表</button>
      </div>
    );
  }
  return (
    <div className="dg-report-reader">
      <div className="dg-report-reader-head">
        <button type="button" className="dg-report-btn" onClick={onBackToScan}>← 扫描列表</button>
        <span className="dg-report-disclaimer">{DISCLAIMER}</span>
      </div>
      {report.headline && <h2 className="dg-report-reader-h">{report.headline}</h2>}
      {Array.isArray(report.highlights) && report.highlights.length > 0 && (
        <section className="dg-report-reader-sec">
          <h3>今日要点</h3>
          <ul>{report.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </section>
      )}
      {Array.isArray(report.themes) && report.themes.length > 0 && (
        <section className="dg-report-reader-sec">
          <h3>主题分组</h3>
          {report.themes.map((t, i) => (
            <article key={i} className="dg-report-theme">
              <h4>{t.title}</h4>
              <p>{t.summary}</p>
            </article>
          ))}
        </section>
      )}
      {Array.isArray(report.priorityPicks) && report.priorityPicks.length > 0 && (
        <section className="dg-report-reader-sec">
          <h3>值得优先看</h3>
          <ol className="dg-report-picks">
            {report.priorityPicks.map((p) => (
              <li key={p.paperId}>
                <button type="button" className="dg-report-pick-t" onClick={() => onJumpPaper(p.paperId)}>{p.title}</button>
                <p>{p.reason}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
