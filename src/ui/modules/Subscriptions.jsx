// Lumina Feed · 订阅简报（Subscriptions / Digest）—— patch: subscriptions
// 订阅【关键词 或 期刊(ISSN 锚定)】+ 频率 + 成本闸；今日证据简报（每条可取全文/总结/标记已读，一键批量取 OA）。
// 诚实分层：订阅 CRUD 经 bridge（接引擎 subs:* / 无引擎走会话内存 mock）；今日命中需引擎调度真实检索——
// 无引擎时简报为空并标注「需引擎调度」，绝不伪造命中（红线：不臆造、AI 不替判定纳入）。
import React, { useState, useEffect, useCallback } from "react";
import { Rss, Clock, Plus, Inbox, Download, X, Check, Pause, Play, Pencil, Trash2, Sparkles, FileText, BookOpen, BookText, Loader, AlertTriangle, Info } from "lucide-react";
import { bridge, hasBackend } from "../lumina-bridge.js";
import FetchBadges from "../FetchBadges.jsx";
import DigestMatchWhy from "../components/DigestMatchWhy.jsx";
import DigestSourceLine from "../components/DigestSourceLine.jsx";
import { dedupeDigestEntries, DIGEST_PAGE } from "../lib/digest-ui.js";
import { isFetched, fetchProgressUi } from "../fetch-meta.js";

const FREQ = { daily: "每日", weekly: "每周", hourly: "每小时" };
const subKind = (s) => s.kind || "keyword";
const subLabel = (s) => s.name || (subKind(s) === "journal" ? (s.journal && s.journal.name) : s.q) || "订阅";
const AUTO = { off: "不自动总结", abstract: "自动总结·摘要", topN: "自动总结·前 3 条", blurb: "一句相关说明" };
const AUTO_OPTS = [["off", "关闭"], ["abstract", "仅摘要"], ["topN", "Top-3"], ["blurb", "相关说明"]];
const FREQ_OPTS = [["daily", "每日"], ["weekly", "每周"], ["hourly", "每小时"]];

const SUBS_CSS = `
.subs{flex:1;min-height:0;display:flex}
.subs-rail{width:288px;flex-shrink:0;border-right:1px solid var(--line);overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:8px;background:var(--surf)}
.subs-rail h3{display:flex;align-items:center;gap:7px;font-size:12px;font-family:'Space Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);margin:2px 4px 6px}
.subs-rail h3 svg{color:var(--gold)}
.subitem{border:1px solid var(--line2);border-radius:11px;padding:10px 12px;background:var(--surf2);display:flex;flex-direction:column;gap:7px}
.subitem.on{border-color:var(--gold);box-shadow:0 0 0 2px rgba(14,124,111,.14)}
.subitem.off{opacity:.62}
.subitem .q{font-size:13px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:6px}
.subitem .nw{font-size:10.5px;font-family:'Space Mono',monospace;background:var(--amber,#E8A13A);color:#3a2a08;border-radius:6px;padding:1px 6px}
.subitem .sc{font-size:11px;color:var(--ink3);display:flex;align-items:center;gap:5px;line-height:1.5;flex-wrap:wrap}
.subctl{display:flex;gap:3px;border-top:1px dashed var(--line2);padding-top:7px}
.subctl button{flex:1;border:none;background:transparent;color:var(--ink3);border-radius:7px;padding:5px;cursor:pointer;display:grid;place-items:center}
.subctl button:hover{background:var(--surf);color:var(--gold)}
.suball{cursor:pointer;text-align:left}
.addsub{margin-top:4px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px dashed var(--line2);background:transparent;color:var(--ink2);border-radius:11px;padding:10px;font-size:13px;cursor:pointer;font-family:inherit}
.addsub:hover{border-color:var(--gold);color:var(--gold)}
.digest{flex:1;min-width:0;display:flex;flex-direction:column}
.dg-head{padding:22px 26px 14px;border-bottom:1px solid var(--line)}
.dg-h1row{display:flex;align-items:flex-start;gap:14px}
.dg-head h1{font-family:'Source Serif 4',Georgia,serif;font-size:24px;font-weight:600;margin:0;color:var(--ink)}
.dg-date{font-family:'Space Mono',monospace;font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.1em;margin-top:6px}
.dg-head p.brief-lead{font-size:13.5px;color:var(--ink2);margin:12px 0 0;line-height:1.6;text-wrap:pretty}
.dg-head p.brief-lead b,.dg-head p.brief-lead .keep{white-space:nowrap}
.dg-batch{display:inline-flex;align-items:center;gap:7px;border:none;background:var(--gold);color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap}
.dg-note{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.55;color:#9a6b2e;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:10px 13px;margin:12px 0 0}
.dg-note svg{flex-shrink:0;margin-top:1px}
.dg-list{flex:1;min-height:0;overflow-y:auto;padding:14px 26px 28px;display:flex;flex-direction:column;gap:12px}
.dg-grp-h{display:flex;align-items:center;gap:9px;margin:8px 0 4px}
.dg-grp-h h4{font-family:'Source Serif 4',Georgia,serif;font-size:15px;margin:0;color:var(--ink)}
.dg-grp-h .ct{font-size:11px;font-family:'Space Mono',monospace;color:var(--ink3)}
.dg-grp-h .ln{flex:1;height:1px;background:var(--line)}
.dg-item{border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:var(--surf)}
.dg-t{font-family:'Source Serif 4',Georgia,serif;font-size:15px;font-weight:600;line-height:1.4;color:var(--ink)}
.dg-m{font-size:12.5px;color:var(--ink3);margin-top:5px}
.dg-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dg-b{font-size:10.5px;font-family:'Space Mono',monospace;color:var(--ink3);background:var(--surf2);border:1px solid var(--line);border-radius:6px;padding:3px 7px}
.dg-b-ret{color:#b42318;background:rgba(180,35,24,.08)}
.dg-b-pre{color:#9a6b2e}
.dg-b-oa{color:var(--gold)}
.dg-b-ft,.dg-b-alt,.dg-b-nooa{font-size:10.5px;font-family:'Space Mono',monospace;background:var(--surf2);border:1px solid var(--line);border-radius:6px;padding:3px 7px}
.dg-b-ft{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.dg-b-alt{color:var(--ink2);border-color:var(--line2)}
.dg-b-nooa{color:var(--ink3)}
.dg-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px}
.dg-act{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.dg-act:hover{border-color:var(--gold);color:var(--gold)}
.dg-sum{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--surf2);font-size:12.5px;line-height:1.65;color:var(--ink)}
.dg-basis{font-size:10.5px;font-family:'Space Mono',monospace;color:var(--gold);margin-bottom:5px;display:inline-block}
.dg-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:50px 24px;text-align:center;color:var(--ink2);min-height:240px}
.dg-empty h2{margin:0;font-size:18px;font-family:'Source Serif 4',Georgia,serif;color:var(--ink)}
.dg-empty p{margin:0;font-size:13.5px;line-height:1.6;max-width:460px}
.subs-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px}
.subs-dlg{width:100%;max-width:480px;background:var(--surf);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:14px;padding:20px 22px;max-height:90vh;overflow-y:auto}
.subs-dlg h2{font-family:'Source Serif 4',Georgia,serif;font-size:18px;margin:0;color:var(--ink);display:flex;align-items:center;justify-content:space-between}
.subs-dlg h2 button{border:none;background:transparent;color:var(--ink3);cursor:pointer;padding:2px}
.subs-f{display:flex;flex-direction:column;gap:6px}
.subs-f label{font-size:12px;color:var(--ink2);font-weight:500}
.subs-in{border:1px solid var(--line2);border-radius:9px;padding:9px 11px;font-size:13px;font-family:inherit;background:var(--surf);color:var(--ink);outline:none;width:100%;box-sizing:border-box}
.subs-in:focus{border-color:var(--gold)}
.subs-seg{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}
.subs-seg button{border:none;background:transparent;color:var(--ink2);padding:7px 12px;font-size:12px;cursor:pointer;font-family:inherit;border-right:1px solid var(--line2)}
.subs-seg button:last-child{border-right:none}
.subs-seg button.on{background:var(--gold);color:#fff}
.subs-hint{font-size:11px;color:var(--ink4);line-height:1.5}
.subs-dlg-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
.subs-btn{border:none;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.subs-btn.primary{background:linear-gradient(135deg,var(--gold),var(--goldDim));color:#fff;box-shadow:0 2px 8px var(--gold-tint)}
.subs-btn.ghost{background:var(--surf2);color:var(--ink2)}
.subs-btn:disabled{opacity:.6;cursor:default}
.subs-mono{font-family:'Space Mono',monospace;font-size:12.5px}
.subkind{font-size:10px;font-family:'Space Mono',monospace;background:rgba(14,124,111,.1);color:var(--gold);border-radius:5px;padding:1px 5px;margin-right:5px}
`;

function DigestItem({ p, query, subLabels, fetchedMeta, fetchingMeta, onFetch, onReadPaper, onRead, pushToast, fetchOpts }) {
  const [sum, setSum] = useState(null);
  const [summing, setSumming] = useState(false);
  const got = isFetched(fetchedMeta);
  const isFetching = !!(fetchingMeta && fetchingMeta.startedAt);
  const prog = isFetching ? fetchProgressUi(fetchingMeta, Date.now()) : null;
  useEffect(() => {
    if (p.digestSummary) {
      setSum({ text: p.digestSummary, summaryText: p.digestSummary, sourceBasis: p.digestSummaryBasis || "abstract" });
      return;
    }
    let alive = true;
    bridge.getCachedSummary(p.id, { depth: "tldr" }).then((c) => {
      if (alive && c?.text) setSum({ text: c.text, summaryText: c.text, sourceBasis: c.sourceBasis, model: c.model });
    }).catch(() => {});
    return () => { alive = false; };
  }, [p.id, p.digestSummary, p.digestSummaryBasis]);
  const doSum = async () => {
    setSumming(true);
    try {
      const r = await bridge.summarize(p.id, { depth: "tldr", scope: "digest_hits", source: "abstract_only", fetchPdf: "no" });
      setSum(r || { summaryText: "（无总结）", sourceBasis: "abstract" });
    } catch (e) { pushToast && pushToast("总结失败"); } finally { setSumming(false); }
  };
  const hasAutoSum = !!(sum && (p.digestSummary || p.digestSummaryBasis));
  return (
    <div className="dg-item">
      <div className="dg-t">{p.title}</div>
      <div className="dg-m">{(p.authors || [])[0]}{(p.authors || []).length > 1 ? " 等" : ""}{p.journal ? " · " + p.journal : ""}{p.year ? " · " + p.year : ""}</div>
      <DigestMatchWhy paper={p} query={query} subLabels={subLabels} />
      <DigestSourceLine sources={p.hitSources} />
      {p.digestBlurb && <div className="dg-blurb">{p.digestBlurb}</div>}
      <FetchBadges p={p} fetchedMeta={fetchedMeta} badgePrefix="dg-b" compact />
      {sum && (
        <div className="dg-sum"><span className="dg-basis">● {sum.sourceBasis === "fulltext" || sum.sourceBasis === "full" ? "基于全文" : "基于摘要"}{hasAutoSum ? " · 自动" : ""}</span><div>{sum.summaryText || sum.text}</div></div>
      )}
      <div className="dg-acts">
        <button className="dg-act" onClick={() => onFetch(p, fetchOpts || { provenance: "subscription", channel: "digest" })} disabled={isFetching || got}>
          {isFetching ? <><Loader size={13} className="rd-spin" /> {prog && prog.stageText}</> : got ? <><Check size={13} /> 已取全文</> : <><Download size={13} /> 获取全文</>}
        </button>
        {got && onReadPaper && <button className="dg-act" onClick={() => onReadPaper(p)}><BookOpen size={13} /> 阅读</button>}
        <button className="dg-act" onClick={doSum} disabled={summing}>{summing ? <><Loader size={13} className="rd-spin" /> 总结中…</> : sum ? <><Sparkles size={13} /> 重新总结</> : <><Sparkles size={13} /> AI 总结</>}</button>
        <button className="dg-act" onClick={() => onRead(p.id)}><Check size={13} /> 标记已读</button>
      </div>
    </div>
  );
}

function SubDialog({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial ? initial.name || "" : "");
  const [q, setQ] = useState(initial ? initial.q || "" : "");
  const [freq, setFreq] = useState(initial ? initial.freq || "daily" : "daily");
  const [time, setTime] = useState(initial ? initial.time || "08:00" : "08:00");
  const [autoSummarize, setAuto] = useState(initial ? initial.autoSummarize || "blurb" : "blurb");
  const [kind, setKind] = useState(initial ? (initial.kind || "keyword") : "keyword");
  const [jName, setJName] = useState(initial && initial.journal ? initial.journal.name || "" : "");
  const [issn, setIssn] = useState(initial && initial.journal ? initial.journal.issn || "" : "");
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const valid = kind === "keyword" ? q.trim() : jName.trim();
  const backend = hasBackend();
  const draft = () => kind === "journal"
    ? { id: initial ? initial.id : "preview", name: name.trim(), kind: "journal", journal: { name: jName.trim(), issn: issn.trim() || undefined }, q: jName.trim(), freq, time, autoSummarize, enabled: true }
    : { id: initial ? initial.id : "preview", name: name.trim(), kind: "keyword", q: q.trim(), freq, time, autoSummarize, enabled: true };
  const runPreview = async () => {
    setPreviewBusy(true);
    try {
      const r = await bridge.subsPreview(draft());
      setPreview(r && r.ok ? (r.hits || []) : []);
    } catch { setPreview([]); } finally { setPreviewBusy(false); }
  };
  return (
    <div className="subs-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="subs-dlg">
        <h2>{initial ? "编辑订阅" : "新建订阅"}<button onClick={onClose}><X size={18} /></button></h2>
        <div className="subs-f"><label>订阅类型</label>
          <div className="subs-seg">
            <button className={kind === "keyword" ? "on" : ""} onClick={() => setKind("keyword")}>按关键词</button>
            <button className={kind === "journal" ? "on" : ""} onClick={() => setKind("journal")}>按期刊</button>
          </div>
        </div>
        <div className="subs-f"><label>名称（可选）</label><input className="subs-in" value={name} placeholder={kind === "journal" ? "如：盯 Nat Med 新刊" : "如：CRISPR 脱靶"} onChange={(e) => setName(e.target.value)} /></div>
        {kind === "keyword" ? (
          <div className="subs-f"><label>关键词 / 检索式</label><input className="subs-in" value={q} placeholder="如：CRISPR off-target detection" onChange={(e) => setQ(e.target.value)} /></div>
        ) : (
          <>
            <div className="subs-f"><label>期刊名</label><input className="subs-in" value={jName} placeholder="如：Nature Medicine" onChange={(e) => setJName(e.target.value)} /></div>
            <div className="subs-f"><label>ISSN（可选，更精准）</label><input className="subs-in subs-mono" value={issn} placeholder="如 1078-8956" onChange={(e) => setIssn(e.target.value)} />
              <span className="subs-hint">刊名可能有歧义；填 ISSN 由引擎按 ISSN 精确匹配各源（PubMed [TA] / Crossref / OpenAlex）。期刊命中检索由引擎按计划执行。</span>
            </div>
          </>
        )}
        <div className="subs-f"><label>频率</label>
          <div className="subs-seg">{FREQ_OPTS.map(([k, l]) => <button key={k} className={freq === k ? "on" : ""} onClick={() => setFreq(k)}>{l}</button>)}</div>
        </div>
        <div className="subs-f"><label>运行时间</label><input className="subs-in" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ maxWidth: 140 }} /></div>
        <div className="subs-f"><label>成本闸（自动总结）</label>
          <div className="subs-seg">{AUTO_OPTS.map(([k, l]) => <button key={k} className={autoSummarize === k ? "on" : ""} onClick={() => setAuto(k)}>{l}</button>)}</div>
          <span className="subs-hint">默认「相关说明」：每条一句为何相关（推荐）。abstract/topN 会调用完整总结管线。未配置 LLM 时将跳过并提示。</span>
        </div>
        {backend && (
          <div className="subs-f">
            <button type="button" className="subs-preview-btn" disabled={!valid || previewBusy} onClick={runPreview}>
              {previewBusy ? "试跑中…" : "预览命中（约 5 条）"}
            </button>
            {preview && (
              <div className="dg-preview">
                <div className="dg-preview-h">试跑样本 · 本次检索（非数据库总数）</div>
                {preview.length === 0 ? <div className="dg-preview-item">暂无样本命中</div> : preview.map((p) => (
                  <div key={p.id} className="dg-preview-item">
                    <div>{p.title}</div>
                    {p.digestBlurb && <div className="dg-preview-blurb">{p.digestBlurb}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="subs-dlg-acts">
          <button className="subs-btn ghost" onClick={onClose}>取消</button>
          <button className="subs-btn primary" disabled={!valid} onClick={() => onSave(
            kind === "journal"
              ? { id: initial ? initial.id : "s" + Date.now(), name: name.trim(), kind: "journal", journal: { name: jName.trim(), issn: issn.trim() || undefined }, q: jName.trim(), freq, time, autoSummarize, enabled: initial ? initial.enabled !== false : true, today: initial ? initial.today || [] : [] }
              : { id: initial ? initial.id : "s" + Date.now(), name: name.trim(), kind: "keyword", q: q.trim(), freq, time, autoSummarize, enabled: initial ? initial.enabled !== false : true, today: initial ? initial.today || [] : [] }
          )}>保存</button>
        </div>
      </div>
    </div>
  );
}

export default function Subscriptions({ pushToast, fetchedMeta = {}, fetchingMeta = {}, fetchTick = 0, onFetch: onFetchProp, onFetchBatch, onReadPaper, onSubsChange, inLibFn }) {
  const [subs, setSubs] = useState([]);
  const [activeSub, setActiveSub] = useState("all");
  const [seen, setSeen] = useState({});
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editSub, setEditSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadMore, setLoadMore] = useState({});
  const [runProgress, setRunProgress] = useState(null);
  const backend = hasBackend();

  useEffect(() => {
    let alive = true; setLoading(true);
    bridge.subsList().then((list) => { if (alive) setSubs(Array.isArray(list) ? list : []); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && dlgOpen) { setDlgOpen(false); setEditSub(null); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [dlgOpen]);

  const persist = useCallback(async (sub) => { await bridge.subsSave(sub); }, []);
  const subPatch = useCallback((id, patch) => { setSubs((s) => s.map((x) => { if (x.id !== id) return x; const u = { ...x, ...patch }; persist(u); return u; })); }, [persist]);
  const subRemove = useCallback(async (id) => {
    await bridge.subsRemove(id);
    setSubs((s) => s.filter((x) => x.id !== id));
    if (activeSub === id) setActiveSub("all");
    onSubsChange?.();
    pushToast && pushToast("订阅已删除");
  }, [activeSub, pushToast, onSubsChange]);
  const onSaveSub = useCallback(async (sub) => {
    const saved = (await bridge.subsSave(sub)) || sub;
    setSubs((s) => { const i = s.findIndex((x) => x.id === saved.id); if (i >= 0) { const n = s.slice(); n[i] = saved; return n; } return [...s, saved]; });
    setDlgOpen(false); setEditSub(null);
    onSubsChange?.();
    pushToast && pushToast(sub.name || sub.q ? "订阅已保存" : "订阅已保存");
  }, [pushToast, onSubsChange]);
  const subRunNow = useCallback(async (sub) => {
    setRunProgress({ label: "检索中…", current: 0, total: 0 });
    const r = await bridge.subsRunNow(sub, {
      onProgress: (p) => setRunProgress({ label: p.label || "处理中…", current: p.current || 0, total: p.total || 0 }),
      onUpdated: async ({ subId }) => {
        const list = await bridge.subsList();
        const updated = list.find((x) => x.id === subId);
        if (updated) setSubs((s) => s.map((x) => (x.id === subId ? updated : x)));
        setRunProgress(null);
        onSubsChange?.();
        pushToast && pushToast("简报 AI 内容已更新");
      },
    });
    if (r?.meta?.ai?.status === "queued") {
      pushToast && pushToast("检索完成，正在后台生成 AI 内容…");
    } else {
      setRunProgress(null);
    }
    if (r && r.ok) {
      if (Array.isArray(r.hits)) {
        setSubs((s) => s.map((x) => (x.id === sub.id ? { ...x, today: r.hits } : x)));
      }
      onSubsChange?.();
      const n = typeof r.newCount === "number" ? r.newCount : (r.hits || []).length;
      if (r.aiSkippedReason === "llm_not_configured") {
        pushToast && pushToast("未配置 LLM · 请在设置中填写 API Key 后重试");
      } else if (n > 0) {
        pushToast && pushToast("已检索：新增 " + n + " 条待读" + (r.meta?.ai?.blurbs ? " · " + r.meta.ai.blurbs + " 条相关说明" : ""));
      } else {
        pushToast && pushToast(backend ? "本次没有新命中" : "需引擎调度真实检索（原型未接后端）");
      }
    } else {
      setRunProgress(null);
      pushToast && pushToast(backend ? "本次没有新命中" : "需引擎调度真实检索（原型未接后端）");
    }
  }, [backend, pushToast, onSubsChange]);
  const markRead = useCallback((id) => setSeen((p) => ({ ...p, [id]: true })), []);

  const today = new Date();
  const todayPapers = (s) => Array.isArray(s.today) ? s.today.filter((p) => p && typeof p === "object") : [];
  const unread = (s) => todayPapers(s).filter((p) => !seen[p.id]);
  const shown = activeSub === "all" ? subs : subs.filter((s) => s.id === activeSub);
  const total = shown.reduce((n, s) => n + (s.enabled !== false ? unread(s).length : 0), 0);
  const preprintCount = shown.reduce((n, s) => n + unread(s).filter((p) => p.preprint).length, 0);
  const allPending = [];
  shown.forEach((s) => { if (s.enabled !== false) unread(s).forEach((p) => { if (!isFetched(fetchedMeta[p.id]) && !fetchingMeta[p.id]) allPending.push(p); }); });

  const batchProvenance = activeSub === "all" ? "subscription" : `subscription:${activeSub}`;
  const batchFetchOpts = { provenance: batchProvenance, channel: "batch" };

  const buildGroups = () => {
    if (activeSub === "all") {
      const entries = [];
      shown.forEach((s) => {
        if (s.enabled === false) return;
        unread(s).forEach((p) => entries.push({ subId: s.id, subLabel: subLabel(s), paper: p, query: s.q || subLabel(s) }));
      });
      return dedupeDigestEntries(entries).map((d) => ({
        key: d.paper.id,
        title: d.subLabels.length > 1 ? "多订阅命中" : d.subLabels[0],
        subLabels: d.subLabels,
        query: d.query,
        papers: [d.paper],
        isMerged: d.subLabels.length > 1,
        fetchOpts: { provenance: "subscription", channel: "digest" },
      }));
    }
    return shown.filter((s) => s.enabled !== false && unread(s).length).map((s) => ({
      key: s.id,
      title: subLabel(s),
      subLabels: [subLabel(s)],
      query: s.q || subLabel(s),
      papers: unread(s),
      isMerged: false,
      fetchOpts: { provenance: `subscription:${s.id}`, channel: "digest" },
    }));
  };
  const groups = buildGroups();
  const visibleLimit = (gid) => loadMore[gid] || DIGEST_PAGE;
  const bumpLoad = (gid, totalN) => setLoadMore((m) => ({ ...m, [gid]: Math.min(totalN, (m[gid] || DIGEST_PAGE) + DIGEST_PAGE) }));

  return (
    <div className="subs">
      <style>{SUBS_CSS}</style>
      <div className="subs-rail">
        <h3><Rss size={13} /> 我的订阅</h3>
        <button className={"subitem suball" + (activeSub === "all" ? " on" : "")} onClick={() => setActiveSub("all")}>
          <div className="q">今日全部简报</div>
          <div className="sc"><Inbox size={13} /> {subs.reduce((n, s) => n + unread(s).length, 0)} 篇待读 · {subs.length} 个订阅</div>
        </button>
        {subs.map((s) => (
          <div key={s.id} className={"subitem" + (activeSub === s.id ? " on" : "") + (s.enabled === false ? " off" : "")}>
            <div onClick={() => setActiveSub(s.id)} style={{ cursor: "pointer" }}>
              <div className="q">{subKind(s) === "journal" ? <BookText size={13} style={{ verticalAlign: "-2px", marginRight: 4, color: "var(--gold)" }} /> : null}{subLabel(s).slice(0, 24)}{unread(s).length ? <span className="nw">+{unread(s).length}</span> : null}</div>
              <div className="sc">{subKind(s) === "journal" ? <span className="subkind">期刊{s.journal && s.journal.issn ? " · " + s.journal.issn : ""}</span> : null}<Clock size={12} /> {FREQ[s.freq] || s.freq} {s.time}{s.enabled === false ? " · 已暂停" : ""} · {AUTO[s.autoSummarize || "off"]}</div>
            </div>
            <div className="subctl">
              <button title="立即运行一次" onClick={() => subRunNow(s)}><Clock size={13} /></button>
              <button title={s.enabled === false ? "恢复" : "暂停"} onClick={() => subPatch(s.id, { enabled: s.enabled === false })}>{s.enabled === false ? <Play size={13} /> : <Pause size={13} />}</button>
              <button title="编辑" onClick={() => { setEditSub(s); setDlgOpen(true); }}><Pencil size={13} /></button>
              <button title="删除" onClick={() => subRemove(s.id)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
        <button className="addsub" onClick={() => { setEditSub(null); setDlgOpen(true); }}><Plus size={15} /> 新建订阅</button>
      </div>

      <div className="digest">
        <div className="dg-head">
          <div className="dg-h1row">
            <div style={{ flex: 1 }}>
              <h1>今日证据简报</h1>
              <div className="dg-date">{today.getMonth() + 1} 月 {today.getDate()} 日 · 本机生成</div>
            </div>
            {allPending.length > 0 && (onFetchBatch || onFetchProp) && (
              <button className="dg-batch" onClick={() => {
                if (onFetchBatch) onFetchBatch(allPending, batchFetchOpts);
                else allPending.forEach((p) => onFetchProp(p, batchFetchOpts));
              }}><Download size={14} /> 取本批全部（{allPending.length}）</button>
            )}
          </div>
          <p className="brief-lead">你订阅的主题共有 <b>{total} 篇</b> 待读新发表。每条都标了证据来源，可直接取全文或让 AI 总结——<b>是否纳入你的研究，由你判断</b>。</p>
          {total > 0 && (
            <div className="dg-tldr">
              <span>待读 <b>{total}</b> 篇</span>
              {preprintCount > 0 && <span className="dg-tldr-pill">预印本 {preprintCount}</span>}
              <span className="dg-tldr-hi">按相关度排序</span>
              <span title="简报检索与设置中的数据源/深度一致；计数为本次检索合并去重结果，非数据库总数">继承全局数据源设置 · 本次检索</span>
            </div>
          )}
          {runProgress && (
            <div className="dg-run-progress">
              <Loader size={14} className="rd-spin" />
              <span>{runProgress.label}</span>
              {runProgress.total > 0 && <span className="dg-run-frac">{runProgress.current}/{runProgress.total}</span>}
            </div>
          )}
          {!backend && <div className="dg-note"><Info size={15} /> 原型模式：订阅（含按期刊）可建/编辑/管理，但「今日命中」需引擎按计划真实检索——关键词按检索式、期刊按 ISSN/刊名匹配各源（PubMed/Crossref/OpenAlex）。接入 Electron 引擎后，每日新发表会自动出现在这里。</div>}
        </div>
        <div className="dg-list">
          {loading ? (
            <div className="dg-empty"><Loader size={22} className="rd-spin" /><p>读取订阅…</p></div>
          ) : subs.length === 0 ? (
            <div className="dg-empty"><Rss size={28} strokeWidth={1.6} /><h2>还没有订阅</h2><p>新建一个主题订阅（关键词 + 频率 + 成本闸），每日的新发表会汇成证据简报，可一键取全文或 AI 总结。</p></div>
          ) : total === 0 ? (
            <div className="dg-empty"><Inbox size={28} strokeWidth={1.6} /><h2>今日没有待读</h2><p>有符合订阅的新发表时会自动出现在这里，并可一键取全文。{!backend ? "（需引擎调度真实检索）" : ""}</p></div>
          ) : (
            groups.map((g) => {
              const lim = visibleLimit(g.key);
              const slice = g.papers.slice(0, lim);
              return (
              <div key={g.key}>
                <div className="dg-grp-h"><Rss size={15} style={{ color: "var(--gold)" }} /><h4>{g.title}</h4><span className="ct">待读 {g.papers.length}</span><span className="ln" /></div>
                {slice.map((p) => (
                  <DigestItem
                    key={p.id}
                    p={p}
                    query={g.query}
                    subLabels={g.isMerged ? g.subLabels : undefined}
                    fetchedMeta={fetchedMeta[p.id]}
                    fetchingMeta={fetchingMeta[p.id]}
                    onFetch={onFetchProp}
                    onReadPaper={onReadPaper}
                    onRead={markRead}
                    pushToast={pushToast}
                    fetchOpts={g.fetchOpts}
                  />
                ))}
                {g.papers.length > lim && (
                  <button type="button" className="dg-loadmore" onClick={() => bumpLoad(g.key, g.papers.length)}>
                    加载更多（还有 {g.papers.length - lim} 篇）
                  </button>
                )}
              </div>
            ); })
          )}
        </div>
      </div>

      {dlgOpen && <SubDialog initial={editSub} onClose={() => { setDlgOpen(false); setEditSub(null); }} onSave={onSaveSub} />}
    </div>
  );
}
