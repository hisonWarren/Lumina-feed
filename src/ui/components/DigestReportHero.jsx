// 简报 · 今日报告（编辑式版式 · 单订阅深度 / 全部订阅综合 两态）
import React from "react";
import { ChevronDown, ChevronUp, ChevronLeft, ArrowRight, Loader, RefreshCw, Settings, Sparkles, AlertTriangle } from "lucide-react";

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

// ── 共享展示件（均无 Hook，可安全作为 <Comp/> 渲染）──

function ModeTag({ mode }) {
  return <span className={"dg-rp-mode " + (mode === "single" ? "single" : "all")}>{mode === "single" ? "单订阅 · 深度" : "全部订阅 · 综合"}</span>;
}

function InferTag({ short }) {
  return <span className="dg-rp-infer"><Sparkles size={11} /> AI 推断 · {short ? "由你判断" : "是否纳入由你判断"}</span>;
}

function ReportLede({ report, scopeLabel, mode }) {
  return (
    <header className="dg-rp-lede">
      <div className="dg-rp-kicker">
        <span className="dg-rp-scope">{scopeLabel}</span>
        <ModeTag mode={mode} />
      </div>
      {report.headline && <h2 className="dg-rp-headline">{report.headline}</h2>}
      <div className="dg-rp-metarow">
        <InferTag />
        <span className="dg-rp-meta">覆盖 {report.paperCount} 篇{mode === "all" ? ` · ${report.subCount} 个订阅` : ""}{report.model ? ` · ${report.model}` : ""}</span>
      </div>
    </header>
  );
}

function ReportSections({ report, titles, jump, mode }) {
  const themePaperCap = mode === "single" ? 10 : 6;
  return (
    <>
      {Array.isArray(report.highlights) && report.highlights.length > 0 && (
        <section className="dg-rp-sec">
          <div className="dg-rp-eyebrow">今日要点</div>
          <ul className="dg-rp-points">
            {report.highlights.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </section>
      )}
      {Array.isArray(report.themes) && report.themes.length > 0 && (
        <section className="dg-rp-sec">
          <div className="dg-rp-eyebrow">主题分组{mode === "single" ? " · 子方向" : ""}</div>
          <div className="dg-rp-themes">
            {report.themes.map((t, i) => (
              <article key={i} className="dg-rp-theme">
                <h4 className="dg-rp-theme-t">{t.title}</h4>
                <p className="dg-rp-theme-s">{t.summary}</p>
                {t.paperIds?.length > 0 && (
                  <div className="dg-rp-links">
                    {t.paperIds.slice(0, themePaperCap).map((id) => (
                      <button key={id} type="button" className="dg-rp-link" title={titles[id] || "跳转到该文献"} onClick={() => jump(id)}>
                        <span className="dg-rp-link-t">{titles[id] || "跳转文献"}</span>
                        <ArrowRight size={11} className="dg-rp-link-i" />
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {Array.isArray(report.priorityPicks) && report.priorityPicks.length > 0 && (
        <section className="dg-rp-sec">
          <div className="dg-rp-eyebrow">值得优先看</div>
          <ol className="dg-rp-picks">
            {report.priorityPicks.map((p, i) => (
              <li key={p.paperId} className="dg-rp-pick">
                <span className="dg-rp-pick-n">{i + 1}</span>
                <div className="dg-rp-pick-main">
                  <button type="button" className="dg-rp-pick-t" onClick={() => jump(p.paperId)}>
                    <span>{p.title || p.paperId}</span>
                    <ArrowRight size={12} className="dg-rp-pick-i" />
                  </button>
                  <p className="dg-rp-pick-r">{p.reason}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

// ── 扫描列表内的可折叠 Hero ──

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
  paperTitleById,
  scopeMode,
  scopeLabel,
}) {
  const status = report?.status || "idle";
  const ready = status === "ready";
  const busy = generating || status === "generating";
  const titles = paperTitleById || {};
  const jump = (id) => onJumpPaper && onJumpPaper(id);
  const mode = scopeMode === "single" ? "single" : "all";
  const label = scopeLabel || (mode === "single" ? "订阅" : "今日全部简报");

  return (
    <section className={"dg-report-hero" + (collapsed ? " collapsed" : "")} data-mode={mode}>
      <div className="dg-report-head">
        <button type="button" className="dg-report-collapse" onClick={onToggleCollapse} aria-expanded={!collapsed}>
          <Sparkles size={16} />
          <span className="dg-report-title">{mode === "single" ? "本订阅 · 今日深度简报" : "今日综合简报"}</span>
          {ready && report.headline && collapsed && <span className="dg-report-headline">{report.headline}</span>}
          {busy && <span className="dg-report-busy"><Loader size={13} className="dg-spin" /> 撰写中…</span>}
          {ready && !collapsed && <span className="dg-report-meta">{fmtTime(report.generatedAt)}</span>}
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <div className="dg-report-actions">
          {viewMode !== "report" && ready && (
            <button type="button" className="dg-report-btn" onClick={onViewReport}>阅读报告</button>
          )}
          <button type="button" className="dg-report-btn" disabled={busy} onClick={() => onGenerate(true)}>
            {busy ? <><Loader size={13} className="dg-spin" /> 生成中</> : <><RefreshCw size={13} /> {ready ? "刷新" : "生成报告"}</>}
          </button>
          <button type="button" className="dg-report-icon" title="简报报告设置" onClick={onOpenSettings}><Settings size={15} /></button>
        </div>
      </div>

      {!collapsed && (
        <div className="dg-report-body">
          <div className="dg-rp-kicker compact">
            <span className="dg-rp-scope">{label}</span>
            <ModeTag mode={mode} />
            <InferTag short />
          </div>

          {status === "skipped" && report.skippedReason === "llm_not_configured" && (
            <div className="dg-report-note"><AlertTriangle size={14} /> 未配置大模型 · 请在设置中填写 API Key 后生成报告</div>
          )}
          {status === "skipped" && report.skippedReason === "auto_off" && !ready && (
            <div className="dg-report-note">自动生成已关闭 · 点击「生成报告」手动撰写，或在设置中开启</div>
          )}
          {status === "failed" && (
            <div className="dg-report-note"><AlertTriangle size={14} /> 报告生成失败{report.error ? `（${report.error}）` : ""} · 点「刷新」重试</div>
          )}
          {busy && !ready && (
            <div className="dg-report-note"><Loader size={14} className="dg-spin" /> 正在归纳 {report?.paperCount || "…"} 篇待读… 列表可先浏览</div>
          )}

          {ready && (
            <>
              {report.headline && <p className="dg-rp-lead">{report.headline}</p>}
              <ReportSections report={report} titles={titles} jump={jump} mode={mode} />
              {viewMode !== "report" && onViewReport && (
                <button type="button" className="dg-rp-expand" onClick={onViewReport}>展开完整报告 <ArrowRight size={13} /></button>
              )}
              <div className="dg-rp-foot">覆盖 {report.paperCount} 篇{mode === "all" ? ` · ${report.subCount} 个订阅` : ""}{report.model ? ` · ${report.model}` : ""}</div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── 今日报告整页（reader）──

export function DigestReportReader({ report, onJumpPaper, onBackToScan, onGenerate, generating, paperTitleById, scopeMode, scopeLabel, onOpenSettings }) {
  const busy = generating || report?.status === "generating";
  const titles = paperTitleById || {};
  const jump = (id) => onJumpPaper && onJumpPaper(id);
  const mode = scopeMode === "single" ? "single" : "all";
  const label = scopeLabel || (mode === "single" ? "订阅" : "今日全部简报");

  if (busy && (!report || report.status !== "ready")) {
    return (
      <div className="dg-report-reader dg-rp-state" data-mode={mode}>
        <Loader size={26} className="dg-spin dg-rp-state-icon busy" />
        <p className="dg-rp-state-t">正在撰写{mode === "single" ? "单主题深度" : "今日综合"}简报…</p>
        <p className="dg-rp-state-d">{report?.paperCount ? `归纳 ${report.paperCount} 篇待读，` : "AI 正在归纳待读文献，"}列表可先浏览。</p>
        <div className="dg-rp-state-btns"><button type="button" className="dg-rp-btn ghost" onClick={onBackToScan}><ChevronLeft size={14} /> 扫描列表</button></div>
      </div>
    );
  }
  if (!report || report.status !== "ready") {
    const failed = report?.status === "failed";
    const noLlm = report?.skippedReason === "llm_not_configured";
    return (
      <div className="dg-report-reader dg-rp-state" data-mode={mode}>
        <div className={"dg-rp-state-icon" + (failed ? " warn" : "")}>{failed ? <AlertTriangle size={26} /> : <Sparkles size={26} />}</div>
        <p className="dg-rp-state-t">{noLlm ? "未配置大模型" : failed ? "报告生成失败" : "报告尚未就绪"}</p>
        <p className="dg-rp-state-d">
          {noLlm
            ? "今日报告由 AI 基于标题 + 摘要归纳，请先在设置中填写模型 API Key。"
            : failed
              ? (report.error ? `原因：${report.error}。可重试，或在设置中换用更稳定 / 上下文更长的模型。` : "可能是模型超时或网络波动 —— 重试通常即可恢复。")
              : "系统会在有待读时自动生成；也可手动触发。"}
        </p>
        <div className="dg-rp-state-btns">
          {onGenerate && (
            <button type="button" className="dg-rp-btn primary" disabled={busy} onClick={() => onGenerate(true)}>
              {busy ? <><Loader size={13} className="dg-spin" /> 生成中…</> : <><RefreshCw size={13} /> {failed ? "重试生成" : "生成报告"}</>}
            </button>
          )}
          {noLlm && onOpenSettings && <button type="button" className="dg-rp-btn" onClick={onOpenSettings}><Settings size={13} /> 去设置</button>}
          <button type="button" className="dg-rp-btn ghost" onClick={onBackToScan}><ChevronLeft size={14} /> 扫描列表</button>
        </div>
      </div>
    );
  }
  return (
    <div className="dg-report-reader dg-rp-reader" data-mode={mode}>
      <div className="dg-rp-topbar">
        <button type="button" className="dg-rp-back" onClick={onBackToScan}><ChevronLeft size={15} /> 扫描列表</button>
        {onGenerate && (
          <button type="button" className="dg-rp-refresh" disabled={busy} onClick={() => onGenerate(true)} title="重新生成">
            {busy ? <Loader size={13} className="dg-spin" /> : <RefreshCw size={13} />} 刷新
          </button>
        )}
      </div>
      <ReportLede report={report} scopeLabel={label} mode={mode} />
      <ReportSections report={report} titles={titles} jump={jump} mode={mode} />
    </div>
  );
}
