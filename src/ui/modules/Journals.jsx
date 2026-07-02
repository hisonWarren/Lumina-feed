// Lumina Feed · 期刊信息（尽职调查 / 避坑工具）
// 定位：分区 + 预警 + OA 正规性 + JIF（wos-journal.info 数据集，可导入/在线拉取）
import React, { useState, useCallback, useEffect, useRef } from "react";
import { bridge } from "../lumina-bridge.js";
import {
  Search, RefreshCw, ExternalLink, AlertTriangle, ShieldCheck, BadgeCheck,
  Loader2, Database, Upload, X, Info, BookOpenCheck, Sparkles, Check, ChevronDown,
} from "lucide-react";

const CSS = `
.jr{flex:1;min-height:0;display:block;overflow-y:auto;padding:16px 20px 44px;scrollbar-gutter:stable;scroll-behavior:smooth}
.jr-head{max-width:920px;margin:0 auto;width:100%}
.jr-h1{font-family:'Source Serif 4',Georgia,serif;font-size:19px;font-weight:600;color:var(--ink);margin:2px 0 3px}
.jr-sub{font-size:12.5px;color:var(--ink3);margin-bottom:14px;line-height:1.5}
.jr-bar{display:flex;align-items:center;gap:10px;border:1px solid var(--line2);border-radius:12px;padding:10px 14px;background:var(--surf)}
.jr-bar input{flex:1;border:none;outline:none;font-size:14px;font-family:inherit;background:transparent;color:var(--ink)}
.jr-go{display:inline-flex;align-items:center;gap:6px;border:none;background:var(--gold);color:#fff;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.jr-go:disabled{opacity:.6;cursor:default}
.jr-clr{border:none;background:transparent;color:var(--ink3);cursor:pointer;display:grid;place-items:center;padding:2px;border-radius:6px}
.jr-clr:hover{color:var(--ink);background:var(--surf2)}
.jr-ex{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;align-items:center}
.jr-exl{font-size:11px;color:var(--ink4);font-family:'Space Mono',monospace}
.jr-chip{border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.jr-chip:hover{border-color:var(--gold);color:var(--gold)}
.jr-body{max-width:920px;margin:16px auto 0;width:100%}
.jr-card{border:1px solid var(--line);border-radius:16px;background:var(--surf);overflow:hidden;box-shadow:var(--shadow)}
.jr-warn{display:flex;gap:10px;align-items:flex-start;background:rgba(188,59,43,.08);border-bottom:1px solid rgba(188,59,43,.22);color:#9a2b1e;padding:12px 18px;font-size:13px;line-height:1.5}
.jr-warn.hist{background:rgba(190,122,24,.09);border-bottom-color:rgba(190,122,24,.28);color:#8a5a10}
.jr-warn b{font-weight:700}
.jr-top{padding:18px 20px 6px}
.jr-name{font-family:'Source Serif 4',Georgia,serif;font-size:20px;font-weight:600;color:var(--ink);line-height:1.3}
.jr-pub{font-size:12.5px;color:var(--ink3);margin-top:5px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.jr-issn{font-family:'Space Mono',monospace;font-size:11.5px;color:var(--ink2)}
.jr-tags{display:flex;flex-wrap:wrap;gap:7px;padding:8px 20px 0}
.jr-q{display:inline-flex;align-items:center;gap:5px;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;border-radius:8px;padding:4px 10px;color:#fff}
.jr-q.Q1{background:#2C8A60}.jr-q.Q2{background:#2f7db8}.jr-q.Q3{background:#BE7A18}.jr-q.Q4{background:#BC3B2B}
.jr-tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-family:'Space Mono',monospace;border-radius:8px;padding:4px 9px;border:1px solid var(--line2);color:var(--ink2);background:var(--surf2)}
.jr-tag.oa{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.jr-tag.doaj{color:var(--gold);border-color:var(--gold-line)}
.jr-spotlight{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px 20px 4px}
@media(max-width:720px){.jr-spotlight{grid-template-columns:1fr}}
.jr-hero{position:relative;border-radius:12px;padding:12px 15px 11px;overflow:hidden;border:1px solid var(--line);background:var(--surf2);min-height:84px;display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none}
.jr-hero.clickable{cursor:pointer}
.jr-hero.clickable:hover{border-color:var(--gold)}
.jr-hero::before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--gold);opacity:.85}
.jr-hero.jr-hero-jif::before{background:var(--gold)}
.jr-hero.jr-hero-cas::before{background:var(--hero-cas-accent,#C0392B)}
.jr-hero.jr-hero-q::before{background:var(--hero-q-accent,#2C8A60)}
.jr-hero.dim{background:var(--surf2)}
.jr-hero.dim::before{opacity:.35}
.jr-hero-lbl{font-size:11px;font-weight:700;font-family:'Space Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2);margin-bottom:7px}
.jr-hero-jif .jr-hero-lbl{color:var(--gold)}
.jr-hero-cas .jr-hero-lbl{color:#A82E22}
.jr-hero-q .jr-hero-lbl{color:#217A52}
.jr-hero-val{font-family:'Source Serif 4',Georgia,serif;font-size:clamp(24px,3vw,31px);font-weight:700;color:var(--ink);line-height:1;letter-spacing:-.02em}
.jr-hero-qbadge{font-family:'Source Serif 4',Georgia,serif;font-size:clamp(26px,3.4vw,32px);font-weight:700;line-height:1;letter-spacing:-.02em;color:var(--hero-q-accent,#2C8A60)}
.jr-hero-sub{font-size:11.5px;color:var(--ink2);margin-top:5px;font-family:'Space Mono',monospace;line-height:1.35}
.jr-hero-src{font-size:10.5px;color:var(--ink3);font-family:'Space Mono',monospace;margin-top:auto;padding-top:7px;line-height:1.4}
.jr-hero-empty{display:flex;align-items:center;gap:6px;color:var(--ink3);font-size:12.5px;font-family:'Source Serif 4',Georgia,serif;line-height:1}
.jr-hero-empty .m{font-family:'Space Mono',monospace;font-size:20px;font-weight:700;color:var(--ink4)}
.jr-hero.clickable:hover .jr-hero-empty{color:var(--gold)}
.jr-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--line);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:12px}
.jr-metrics-sub .jr-m{padding:12px 16px}
.jr-metrics-sub .jr-mv{font-size:18px}
.jr-m{background:var(--surf);padding:14px 18px}
.jr-mv{font-family:'Space Mono',monospace;font-size:22px;font-weight:700;color:var(--ink);line-height:1}
.jr-mv.dim{color:var(--ink4);font-size:15px;font-weight:500}
.jr-ml{font-size:11.5px;color:var(--ink2);margin-top:7px;display:flex;align-items:center;gap:4px}
.jr-msrc{font-size:10.5px;color:var(--ink3);font-family:'Space Mono',monospace;margin-top:4px}
.jr-cats{padding:14px 20px 4px}
.jr-cats-t{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin-bottom:8px}
.jr-cat{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink2);border:1px solid var(--line);border-radius:7px;padding:3px 8px;margin:0 6px 6px 0}
.jr-cat i{width:8px;height:8px;border-radius:2px;display:inline-block}
.jr-foot{display:flex;flex-wrap:wrap;gap:8px;padding:14px 20px 18px;border-top:1px solid var(--line)}
.jr-act{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit;text-decoration:none}
.jr-act:hover{border-color:var(--gold);color:var(--gold)}
.jr-cand{max-width:920px;margin:12px auto 0;width:100%;border:1px dashed var(--line2);border-radius:12px;padding:12px 16px;background:var(--surf2)}
.jr-cand-t{font-size:12px;color:var(--ink3);margin-bottom:8px}
.jr-cand-i{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line);cursor:pointer}
.jr-cand-i:hover .jr-cand-n{color:var(--gold)}
.jr-cand-n{font-size:13px;color:var(--ink);font-family:'Source Serif 4',Georgia,serif}
.jr-cand-m{font-size:11px;color:var(--ink3);font-family:'Space Mono',monospace}
.jr-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:44px 24px;text-align:center;color:var(--ink2)}
.jr-empty h3{margin:0;font-size:16px;font-family:'Source Serif 4',Georgia,serif;color:var(--ink)}
.jr-empty p{margin:0;font-size:12.5px;color:var(--ink3);max-width:440px;line-height:1.6}
.jr-ds{max-width:920px;margin:18px auto 0;width:100%;border:1px solid var(--line);border-radius:14px;background:var(--surf2);padding:14px 16px}
.jr-ds-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px}
.jr-ds-hint{font-size:12px;color:var(--ink3);line-height:1.65;margin-bottom:14px;padding:10px 12px;background:var(--surf);border:1px solid var(--line);border-radius:9px}
.jr-ds-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surf);margin-bottom:8px}
.jr-ds-actions{display:flex;gap:6px;align-items:center;margin-left:auto;flex-shrink:0}
.jr-ds-actions .jr-btn{justify-content:center;white-space:nowrap}
@media(max-width:640px){.jr-ds-row{flex-wrap:wrap}.jr-ds-actions{margin-left:0;width:100%;flex-wrap:wrap}}
.jr-ds-prog{font-size:11px;color:var(--ink3);font-family:'Space Mono',monospace;line-height:1.5;padding:0 2px 8px 24px;margin-top:-4px}
.jr-spotlight-legend{font-size:11.5px;color:var(--ink3);text-align:center;margin-top:6px;padding:0 20px;font-family:'Space Mono',monospace}
.jr-ds-wrap{max-width:920px;margin:18px auto 0;width:100%;border:1px solid var(--line);border-radius:14px;background:var(--surf2);padding:0;overflow:hidden}
.jr-ds-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;color:var(--ink);padding:14px 16px;cursor:pointer;user-select:none;background:var(--surf2)}
.jr-ds-toggle:hover{color:var(--gold)}
.jr-ds-body{display:none;padding:16px 16px 16px;border-top:1px dashed var(--line2)}
.jr-ds-wrap.open .jr-ds-body{display:block}
.jr-ds-info{flex:1;min-width:0}
.jr-ds-name{font-size:13px;color:var(--ink);font-weight:500}
.jr-ds-meta{font-size:11.5px;color:var(--ink3);font-family:'Space Mono',monospace;margin-top:4px}
.jr-ds-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.jr-ds-dot.on{background:var(--ok)}.jr-ds-dot.off{background:var(--ink4)}
.jr-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.jr-btn:hover{border-color:var(--gold);color:var(--gold)}
.jr-btn:disabled{opacity:.6;cursor:default}
.jr-spin{animation:jrspin .8s linear infinite}
@keyframes jrspin{to{transform:rotate(360deg)}}
.jr-jifprog{font-size:11px;color:var(--ink3);font-family:'Space Mono',monospace;margin-top:6px;line-height:1.5}
.jr-note{font-size:11.5px;color:var(--ink3);line-height:1.65;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}
.jr-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:60;padding:24px}
.jr-modal{width:min(640px,100%);max-height:86vh;display:flex;flex-direction:column;background:var(--surf);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}
.jr-modal-h{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line);font-size:14px;font-weight:600;color:var(--ink)}
.jr-modal-h .x{margin-left:auto;cursor:pointer;color:var(--ink3);display:inline-flex}
.jr-modal-b{padding:14px 18px;overflow-y:auto}
.jr-modal-hint{font-size:11.5px;color:var(--ink3);line-height:1.6;margin-bottom:10px}
.jr-ta{width:100%;min-height:140px;resize:vertical;border:1px solid var(--line2);border-radius:10px;padding:10px 12px;font-size:12.5px;font-family:'Space Mono',monospace;background:var(--surf2);color:var(--ink);outline:none;line-height:1.5}
.jr-ta:focus{border-color:var(--gold)}
.jr-prev{margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.jr-prev-h{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);padding:8px 12px;background:var(--surf2);border-bottom:1px solid var(--line)}
.jr-prev-i{display:flex;gap:10px;padding:7px 12px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink2)}
.jr-prev-i:first-child{border-top:none}
.jr-prev-i .t{flex:1;color:var(--ink)}
.jr-prev-i .m{font-family:'Space Mono',monospace;font-size:11px;color:var(--ink4)}
.jr-modal-f{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--line)}
.jr-modal-f .sp{flex:1;font-size:11px;color:var(--ink4)}
`;

const Q_COLOR = { Q1: "#2C8A60", Q2: "#2f7db8", Q3: "#BE7A18", Q4: "#BC3B2B" };
const CAS_ZONE_COLOR = { "1区": "#C41E3A", "2区": "#D35400", "3区": "#2E86C1", "4区": "#7F8C8D" };
const EXAMPLES = ["Nature", "0028-0836", "PLOS ONE", "1932-6203"];

function fmtDate(iso) {
  if (!iso) return "从未";
  try { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; } catch { return "—"; }
}
function issnForUrl(p) {
  const i = p?.issnL || (p?.issns && p.issns[0]) || "";
  return String(i || "").trim();
}

function Metric({ value, label, hint, source, dim }) {
  return (
    <div className="jr-m">
      <div className={"jr-mv" + (dim ? " dim" : "")}>{value}</div>
      <div className="jr-ml">{label}{hint ? <span title={hint}><Info size={11} /></span> : null}</div>
      {source ? <div className="jr-msrc">{source}</div> : null}
    </div>
  );
}

function HeroEmpty({ loading, srcLabel }) {
  if (loading) {
    return (
      <>
        <div className="jr-hero-empty"><Loader2 size={13} className="jr-spin" /> 查询中…</div>
        <div className="jr-hero-src">{srcLabel}</div>
      </>
    );
  }
  return (
    <>
      <div className="jr-hero-empty"><span className="m">—</span> 未收录 / 去添加</div>
      <div className="jr-hero-src">点击导入或在线拉取</div>
    </>
  );
}

function HeroJif({ jif, loading }) {
  const has = jif?.jif != null;
  const openDs = () => { if (!has && !loading) document.getElementById("jr-ds-toggle")?.click(); };
  return (
    <div className={"jr-hero jr-hero-jif" + (has ? "" : " dim") + (!has && !loading ? " clickable" : "")}
      title="Journal Impact Factor · 第三方汇总，非 Clarivate 官方授权" onClick={openDs}>
      <div className="jr-hero-lbl">JIF</div>
      {has ? (
        <>
          <div className="jr-hero-val">{jif.jif.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
          {jif.jif5yr != null && <div className="jr-hero-sub">5 年 IF · {jif.jif5yr.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>}
          <div className="jr-hero-src">{jif.year ? `wos-journal.info · ${jif.year}` : "wos-journal.info"}</div>
        </>
      ) : <HeroEmpty loading={loading} srcLabel="wos-journal.info" />}
    </div>
  );
}

function HeroCas({ cas, loading }) {
  const zone = cas?.majorZone;
  const zColor = zone ? (CAS_ZONE_COLOR[zone] || "#C0392B") : null;
  const has = !!zone;
  const openDs = () => { if (!has && !loading) document.getElementById("jr-ds-toggle")?.click(); };
  return (
    <div className={"jr-hero jr-hero-cas" + (has ? "" : " dim") + (!has && !loading ? " clickable" : "")}
      style={zColor ? { "--hero-cas-accent": zColor } : undefined}
      title="中科院期刊分区 · LetPub 第三方汇总，非 fenqubiao 官方授权" onClick={openDs}>
      <div className="jr-hero-lbl">中科院分区</div>
      {has ? (
        <>
          <div className="jr-hero-qbadge" style={{ color: zColor }}>{zone}</div>
          {cas.majorCategory && <div className="jr-hero-sub">大类 · {cas.majorCategory}{cas.isTop ? " · Top" : ""}</div>}
          <div className="jr-hero-src">{cas.year ? `LetPub · ${cas.year}` : "LetPub 第三方"}</div>
        </>
      ) : <HeroEmpty loading={loading} srcLabel="LetPub 第三方" />}
    </div>
  );
}

function HeroQuartile({ sj, bestQ }) {
  const qColor = bestQ ? Q_COLOR[bestQ] : null;
  const has = !!bestQ;
  const openDs = () => { if (!has) document.getElementById("jr-ds-toggle")?.click(); };
  return (
    <div className={"jr-hero jr-hero-q" + (has ? "" : " dim") + (!has ? " clickable" : "")}
      style={qColor ? { "--hero-q-accent": qColor } : undefined}
      title="SCImago Journal Rank 最佳学科分区" onClick={openDs}>
      <div className="jr-hero-lbl">SCImago</div>
      {has ? (
        <>
          <div className="jr-hero-qbadge">{bestQ}</div>
          {sj?.sjr != null && <div className="jr-hero-sub">SJR · {sj.sjr.toFixed(3)}{sj.rank != null ? ` · #${sj.rank.toLocaleString()}` : ""}</div>}
          <div className="jr-hero-src">{sj?.year ? `SCImago ${sj.year}` : "SCImago"}</div>
        </>
      ) : <HeroEmpty loading={false} srcLabel="SCImago" />}
    </div>
  );
}

export default function Journals({ pushToast }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [busy, setBusy] = useState({});
  const fileRef = useRef(null);
  const dsWrapRef = useRef(null);
  const sjFileRef = useRef(null);
  const jifFileRef = useRef(null);
  const casFileRef = useRef(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState(null);
  const [jifProgress, setJifProgress] = useState("");
  const [casProgress, setCasProgress] = useState("");
  const [dsOpen, setDsOpen] = useState(false);
  const [liveBusy, setLiveBusy] = useState({});

  const setBusyState = useCallback((id, isBusy) => setBusy((prev) => ({ ...prev, [id]: isBusy })), []);

  const refreshDatasets = useCallback(async () => {
    const ds = await bridge.journalDatasets();
    setDatasets(Array.isArray(ds) ? ds : []);
  }, []);

  useEffect(() => { void refreshDatasets(); }, [refreshDatasets]);

  useEffect(() => {
    const offJif = bridge.onJournalJifProgress((p) => { if (p?.label) setJifProgress(String(p.label)); });
    const offCas = bridge.onJournalCasProgress((p) => { if (p?.label) setCasProgress(String(p.label)); });
    return () => { if (typeof offJif === "function") offJif(); if (typeof offCas === "function") offCas(); };
  }, []);

  const run = useCallback(async (query) => {
    const term = String(query ?? q).trim();
    if (!term) return;
    setLoading(true);
    setProfile(null);
    setLiveBusy({});
    let r = null;
    try {
      r = await bridge.journalSearch(term);
      setProfile(r || { ok: false, query: term, error: "no_result" });
    } catch {
      setProfile({ ok: false, query: term, error: "failed" });
    } finally {
      setLoading(false);
    }
    // 渐进式补齐：JIF / 中科院分区 本地未命中 → 逐刊按需联网（不拖慢主卡片）
    if (r && r.ok) {
      const issns = (r.issns && r.issns.length) ? r.issns : (r.issnL ? [r.issnL] : []);
      const needJif = r.jif == null;
      const needCas = r.cas == null;
      if (issns.length && (needJif || needCas)) {
        setLiveBusy({ jif: needJif, cas: needCas });
        try {
          const live = await bridge.journalLiveMetrics(issns);
          setProfile((prev) => {
            if (!prev || !prev.ok || prev.query !== r.query) return prev;
            const next = { ...prev };
            if (needJif && live?.jif) next.jif = live.jif;
            if (needCas && live?.cas) next.cas = live.cas;
            return next;
          });
        } catch { /* 忽略：保持未命中态 */ }
        finally { setLiveBusy({}); }
      }
    }
  }, [q]);

  const onExample = useCallback((ex) => { setQ(ex); void run(ex); }, [run]);

  const updateScimago = useCallback(async () => {
    setBusyState("scimago", true);
    const r = await bridge.journalUpdateScimago();
    setBusyState("scimago", false);
    if (r?.ok) { pushToast && pushToast("分区数据已更新"); await refreshDatasets(); }
    else pushToast && pushToast("更新失败：" + (r?.error || "网络错误"));
  }, [pushToast, refreshDatasets, setBusyState]);

  const importScimagoFile = useCallback(async (file) => {
    if (!file) return;
    setBusyState("scimago", true);
    try {
      const text = await file.text();
      const r = await bridge.journalImportScimago(text);
      if (r?.ok) { pushToast && pushToast("分区数据已导入 · " + (r.info?.count || 0) + " 条"); await refreshDatasets(); }
      else pushToast && pushToast("导入失败：" + (r?.error || "格式错误"));
    } catch { pushToast && pushToast("读取文件失败"); }
    finally { setBusyState("scimago", false); }
  }, [pushToast, refreshDatasets, setBusyState]);

  const importWarningFile = useCallback(async (file) => {
    if (!file) return;
    setBusyState("warning", true);
    try {
      const text = await file.text();
      const r = await bridge.journalImportWarning(text);
      if (r?.ok) { pushToast && pushToast("预警名单已导入 · " + (r.info?.count || 0) + " 条"); await refreshDatasets(); }
      else pushToast && pushToast("导入失败：" + (r?.error || "格式错误"));
    } catch { pushToast && pushToast("读取文件失败"); }
    finally { setBusyState("warning", false); }
  }, [pushToast, refreshDatasets, setBusyState]);

  const updateJif = useCallback(async () => {
    setBusyState("jif", true);
    setJifProgress("正在连接 wos-journal.info…");
    const r = await bridge.journalUpdateJif();
    setBusyState("jif", false);
    setJifProgress("");
    if (r?.ok) { pushToast && pushToast("JIF 数据已更新 · " + (r.info?.count || 0).toLocaleString() + " 条"); await refreshDatasets(); }
    else pushToast && pushToast("更新失败：" + (r?.error || "网络错误"));
  }, [pushToast, refreshDatasets, setBusyState]);

  const importJifFile = useCallback(async (file) => {
    if (!file) return;
    setBusyState("jif", true);
    try {
      const text = await file.text();
      const r = await bridge.journalImportJif(text);
      if (r?.ok) { pushToast && pushToast("JIF 数据已导入 · " + (r.info?.count || 0).toLocaleString() + " 条"); await refreshDatasets(); }
      else pushToast && pushToast("导入失败：" + (r?.error || "格式错误"));
    } catch { pushToast && pushToast("读取文件失败"); }
    finally { setBusyState("jif", false); }
  }, [pushToast, refreshDatasets, setBusyState]);

  const updateCas = useCallback(async () => {
    if (!window.confirm("LetPub 在线全库拉取约需数十分钟且可能有反爬限制，通常建议优先从学校/课题组 Excel「导入表格」。\n\n确定要继续在线拉取吗？")) return;
    setBusyState("cas", true);
    setCasProgress("正在连接 LetPub…（全库较慢，建议优先导入表格）");
    const r = await bridge.journalUpdateCas();
    setBusyState("cas", false);
    setCasProgress("");
    if (r?.ok) { pushToast && pushToast("中科院分区已更新 · " + (r.info?.count || 0).toLocaleString() + " 条"); await refreshDatasets(); }
    else pushToast && pushToast("更新失败：" + (r?.error || "网络错误"));
  }, [pushToast, refreshDatasets, setBusyState]);

  const importCasFile = useCallback(async (file) => {
    if (!file) return;
    setBusyState("cas", true);
    try {
      const text = await file.text();
      const r = await bridge.journalImportCas(text);
      if (r?.ok) { pushToast && pushToast("中科院分区已导入 · " + (r.info?.count || 0).toLocaleString() + " 条"); await refreshDatasets(); }
      else pushToast && pushToast("导入失败：" + (r?.error || "格式错误"));
    } catch { pushToast && pushToast("读取文件失败"); }
    finally { setBusyState("cas", false); }
  }, [pushToast, refreshDatasets, setBusyState]);

  const closeAi = useCallback(() => { setAiOpen(false); setAiText(""); setAiPreview(null); setAiBusy(false); }, []);

  const aiStructure = useCallback(async () => {
    const t = aiText.trim();
    if (!t) return;
    setAiBusy(true);
    setAiPreview(null);
    try {
      const r = await bridge.journalStructureWarningText(t);
      if (r?.ok && Array.isArray(r.entries) && r.entries.length) setAiPreview(r.entries);
      else pushToast && pushToast("整理失败：" + (r?.error === "no_entries_parsed" ? "未从文本中解析出期刊" : (r?.error || "请检查大模型配置")));
    } catch { pushToast && pushToast("整理失败"); }
    finally { setAiBusy(false); }
  }, [aiText, pushToast]);

  const aiConfirmImport = useCallback(async () => {
    if (!aiPreview || !aiPreview.length) return;
    setAiBusy(true);
    try {
      const r = await bridge.journalImportWarning(JSON.stringify(aiPreview));
      if (r?.ok) { pushToast && pushToast("预警名单已导入 · " + (r.info?.count || 0) + " 条"); await refreshDatasets(); closeAi(); }
      else pushToast && pushToast("导入失败：" + (r?.error || "格式错误"));
    } catch { pushToast && pushToast("导入失败"); }
    finally { setAiBusy(false); }
  }, [aiPreview, pushToast, refreshDatasets, closeAi]);

  const openExt = useCallback((url) => { if (url) bridge.openExternal(url); }, []);

  const p = profile;
  const sj = p?.scimago;
  const jf = p?.jif;
  const cas = p?.cas;
  const bestQ = sj?.bestQuartile && Q_COLOR[sj.bestQuartile] ? sj.bestQuartile : null;
  const issn = p ? issnForUrl(p) : "";

  return (
    <div className="jr">
      <style>{CSS}</style>
      <div className="jr-head">
        <div className="jr-h1">期刊信息</div>
        <div className="jr-sub">
          输入刊名或 ISSN，查看分区、预警状态、JIF、开放获取正规性与类影响因子。JIF 与中科院分区在本地未收录时会<b>逐刊自动在线获取并缓存</b>（wos-journal.info / LetPub 第三方汇总）；也可在下方数据集中批量导入或全库拉取。
        </div>
        <div className="jr-bar">
          <Search size={17} color="var(--ink3)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="期刊名称 或 ISSN（如 Nature / 0028-0836）"
          />
          {q && <button className="jr-clr" onClick={() => { setQ(""); setProfile(null); }} title="清空"><X size={16} /></button>}
          <button className="jr-go" onClick={() => run()} disabled={loading || !q.trim()}>
            {loading ? <Loader2 size={14} className="jr-spin" /> : <Search size={14} />} 查询
          </button>
        </div>
        <div className="jr-ex">
          <span className="jr-exl">试试</span>
          {EXAMPLES.map((ex) => <button key={ex} className="jr-chip" onClick={() => onExample(ex)}>{ex}</button>)}
        </div>
      </div>

      {p && p.ok && (
        <>
          <div className="jr-body">
            <div className="jr-card">
              {p.warning && !p.warningHistorical && (
                <div className="jr-warn">
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <b>该期刊在国际期刊预警名单中</b>
                    {p.warning.level ? `（等级：${p.warning.level}）` : ""}
                    {p.warning.reason ? ` · ${p.warning.reason}` : ""}
                    <div style={{ fontSize: 11, marginTop: 3, opacity: .85 }}>
                      来源：{p.provenance?.warning?.source || "国际期刊预警名单"}
                      {p.warning.year ? ` · ${p.warning.year} 版` : ""} · 投稿前请慎重核实
                    </div>
                  </div>
                </div>
              )}
              {p.warning && p.warningHistorical && (
                <div className="jr-warn hist">
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <b>曾于 {p.warning.year} 年列入预警名单（已移出当前名单）</b>
                    {p.warning.reason ? ` · ${p.warning.reason}` : ""}
                    <div style={{ fontSize: 11, marginTop: 3, opacity: .85 }}>
                      官方规则：期刊经整改移出下年度名单后不再是预警期刊，当前不等于预警；此处仅作历史/回溯参考。
                    </div>
                  </div>
                </div>
              )}
              <div className="jr-top">
                <div className="jr-name">{p.name || p.query}</div>
                <div className="jr-pub">
                  {p.publisher && <span>{p.publisher}</span>}
                  {issn && <span className="jr-issn">ISSN {issn}</span>}
                </div>
              </div>

              <div className="jr-tags">
                {p.isOa && <span className="jr-tag oa"><ShieldCheck size={12} /> 开放获取</span>}
                {p.isInDoaj && <span className="jr-tag doaj"><BadgeCheck size={12} /> DOAJ 收录</span>}
                {!p.warning && <span className="jr-tag" style={{ color: "var(--ok)", borderColor: "color-mix(in srgb,var(--ok) 30%,transparent)" }}><BookOpenCheck size={12} /> 未在预警名单</span>}
              </div>

              <div className="jr-spotlight">
                <HeroJif jif={jf} loading={!!liveBusy.jif} />
                <HeroCas cas={cas} loading={!!liveBusy.cas} />
                <HeroQuartile sj={sj} bestQ={bestQ} />
              </div>
              <div className="jr-spotlight-legend">
                三套独立分区体系，不可互相替代。投稿请以目标期刊所在官方源为准。
              </div>

              <div className="jr-metrics jr-metrics-sub">
                <Metric
                  value={p.impact2yr != null ? p.impact2yr.toFixed(2) : "—"}
                  dim={p.impact2yr == null}
                  label="类影响因子"
                  hint="OpenAlex 近两年篇均被引（2yr mean citedness），非 Clarivate JIF"
                  source="OpenAlex · live"
                />
                <Metric
                  value={p.hIndex != null ? p.hIndex : "—"}
                  dim={p.hIndex == null}
                  label="H 指数"
                  source="OpenAlex · live"
                />
                <Metric
                  value={p.worksCount != null ? p.worksCount.toLocaleString() : "—"}
                  dim={p.worksCount == null}
                  label="累计发文"
                  source="OpenAlex · live"
                />
              </div>

              {cas?.minorCategories && cas.minorCategories.length > 0 && (
                <div className="jr-cats">
                  <div className="jr-cats-t">中科院小类分区{cas.year ? ` · ${cas.year}` : ""}</div>
                  {cas.minorCategories.map((c, i) => (
                    <span key={i} className="jr-cat">
                      <i style={{ background: CAS_ZONE_COLOR[c.zone] || "var(--ink4)" }} />
                      {c.name}{c.zone ? ` · ${c.zone}` : ""}
                    </span>
                  ))}
                </div>
              )}

              {sj?.categories && sj.categories.length > 0 && (
                <div className="jr-cats">
                  <div className="jr-cats-t">学科分区 · SCImago{sj.year ? ` ${sj.year}` : ""}</div>
                  {sj.categories.map((c, i) => (
                    <span key={i} className="jr-cat"><i style={{ background: Q_COLOR[c.quartile] || "var(--ink4)" }} />{c.name} · {c.quartile}</span>
                  ))}
                </div>
              )}

              <div className="jr-foot">
                {p.homepage && <button className="jr-act" onClick={() => openExt(p.homepage)}><ExternalLink size={13} /> 期刊主页</button>}
                {jf?.sourceHomepage && <button className="jr-act" onClick={() => openExt(jf.sourceHomepage)}><ExternalLink size={13} /> wos-journal.info</button>}
                {cas?.sourceHomepage && <button className="jr-act" onClick={() => openExt(cas.sourceHomepage)}><ExternalLink size={13} /> LetPub</button>}
                {issn && <button className="jr-act" onClick={() => openExt(`https://mjl.clarivate.com/search-results?issn=${issn}`)}><ExternalLink size={13} /> Clarivate JCR 官方页</button>}
                <button className="jr-act" onClick={() => openExt("https://www.scimagojr.com/journalsearch.php?q=" + encodeURIComponent(p.name || p.query))}><ExternalLink size={13} /> SCImago 官方页</button>
              </div>
            </div>
          </div>

          {p.candidates && p.candidates.length > 1 && (
            <div className="jr-cand">
              <div className="jr-cand-t">名称匹配到多本，若非目标可选择：</div>
              {p.candidates.slice(0, 6).map((c, i) => (
                <div key={i} className="jr-cand-i" onClick={() => { const t = c.issnL || c.name; setQ(t); void run(t); }}>
                  <span className="jr-cand-n">{c.name}</span>
                  <span className="jr-cand-m">{c.issnL || ""}{c.publisher ? " · " + c.publisher : ""}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {p && !p.ok && !loading && (
        <div className="jr-body">
          <div className="jr-empty">
            <h3>未找到「{p.query}」</h3>
            <p>请换用更完整的刊名或 ISSN（形如 0028-0836）。OpenAlex 以英文刊名为主，中文刊建议用 ISSN 查询。</p>
          </div>
        </div>
      )}

      {!p && !loading && (
        <div className="jr-body">
          <div className="jr-empty">
            <Database size={26} color="var(--ink4)" />
            <h3>查询任意期刊</h3>
            <p>类影响因子、H 指数、OA/DOAJ 每次实时查询；JIF 与中科院分区逐刊按需在线获取并缓存；SCImago 分区与预警名单为本地数据集（可在下方导入/更新）。</p>
          </div>
        </div>
      )}

      <div ref={dsWrapRef} className={"jr-ds-wrap" + (dsOpen ? " open" : "")}>
        <div className="jr-ds-toggle" id="jr-ds-toggle" onClick={() => {
          const next = !dsOpen;
          setDsOpen(next);
          if (next) setTimeout(() => dsWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }}>
          <div style={{display:'flex', alignItems:'center', gap:'8px'}}><Database size={15} /> 数据集 · 手动更新</div>
          <span style={{transform: dsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'flex', alignItems: 'center'}}><ChevronDown size={14} /></span>
        </div>
        <div className="jr-ds-body">
          <div className="jr-ds-hint">
            在线拉取由你手动触发；同一数据集「导入」与「在线拉取」互不冲突——<b>后一次操作会整体覆盖该数据集</b>（不会与别的数据集混写）。类影响因子 / H 指数 / OA 为实时查询，无需更新。
          </div>
          {datasets.map((d) => (
            <React.Fragment key={d.id}>
            <div className="jr-ds-row">
              <span className={"jr-ds-dot " + (d.present ? "on" : "off")} />
              <div className="jr-ds-info">
                <div className="jr-ds-name">{d.label}</div>
                <div className="jr-ds-meta">
                  {d.present
                    ? `${d.count != null ? d.count.toLocaleString() + " 条 · " : ""}${d.year ? d.year + " 版 · " : ""}${d.updatedAt ? "更新于 " + fmtDate(d.updatedAt) : "内置"}`
                    : "未加载"}
                </div>
              </div>
              <div className="jr-ds-actions">
              {d.sourceHomepage && (
                <button className="jr-btn" onClick={() => openExt(d.sourceHomepage)} title="官方/来源页"><ExternalLink size={12} /> 来源</button>
              )}
              {d.id === "scimago" && (
                <>
                  <input ref={sjFileRef} type="file" accept=".csv,.xls,text/csv,application/vnd.ms-excel" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importScimagoFile(f); }} />
                  <button className="jr-btn" onClick={() => sjFileRef.current && sjFileRef.current.click()} disabled={busy["scimago"]} title="从 scimagojr.com 下载的 CSV 导入（最稳）">
                    <Upload size={12} /> 导入
                  </button>
                  <button className="jr-btn" onClick={updateScimago} disabled={busy["scimago"]}>
                    {busy["scimago"] ? <Loader2 size={12} className="jr-spin" /> : <RefreshCw size={12} />} 在线
                  </button>
                </>
              )}
              {d.id === "jif" && (
                <>
                  <input ref={jifFileRef} type="file" accept=".csv,.tsv,.txt,.xls,text/csv" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importJifFile(f); }} />
                  <button className="jr-btn" onClick={() => jifFileRef.current && jifFileRef.current.click()} disabled={busy["jif"]} title="CSV/TSV：ISSN + JIF">
                    <Upload size={12} /> 导入
                  </button>
                  <button className="jr-btn" onClick={updateJif} disabled={busy["jif"]} title="wos-journal.info 全库（数分钟）">
                    {busy["jif"] ? <Loader2 size={12} className="jr-spin" /> : <RefreshCw size={12} />} 在线
                  </button>
                </>
              )}
              {d.id === "cas" && (
                <>
                  <input ref={casFileRef} type="file" accept=".csv,.tsv,.txt,.xls,text/csv" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importCasFile(f); }} />
                  <button className="jr-btn" onClick={() => casFileRef.current && casFileRef.current.click()} disabled={busy["cas"]} title="CSV：ISSN + 大类分区/分区">
                    <Upload size={12} /> 导入
                  </button>
                  <button className="jr-btn" onClick={updateCas} disabled={busy["cas"]} title="LetPub 全库（较慢，建议优先导入）">
                    {busy["cas"] ? <Loader2 size={12} className="jr-spin" /> : <RefreshCw size={12} />} 在线
                  </button>
                </>
              )}
              {d.id === "warning" && (
                <>
                  <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importWarningFile(f); }} />
                  <button className="jr-btn" onClick={() => setAiOpen(true)} disabled={busy["warning"]} title="粘贴官方名单，AI 结构化">
                    <Sparkles size={12} /> 粘贴导入
                  </button>
                  <button className="jr-btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy["warning"]}>
                    {busy["warning"] ? <Loader2 size={12} className="jr-spin" /> : <Upload size={12} />} JSON
                  </button>
                </>
              )}
              </div>
            </div>
            {d.id === "jif" && jifProgress && <div className="jr-ds-prog">{jifProgress}</div>}
            {d.id === "cas" && casProgress && <div className="jr-ds-prog">{casProgress}</div>}
            </React.Fragment>
          ))}
          <div className="jr-note" style={{marginTop:'12px', borderTop:'1px solid var(--line2)', paddingTop:'12px'}}>
            中科院分区无个人官方 API：推荐从学校/课题组 Excel「导入」；「在线」走 <a href="https://www.letpub.com.cn/index.php?page=journalapp" target="_blank" rel="noreferrer">LetPub</a> 第三方汇总（非 fenqubiao 授权，约 4.4 万刊、耗时较长）。JIF 来源 <a href="https://wos-journal.info/" target="_blank" rel="noreferrer">wos-journal.info</a>。SCImago 可官网下 CSV 后导入。预警名单内置 2025 版。
          </div>
        </div>
      </div>

      {aiOpen && (
        <div className="jr-modal-bg" onClick={closeAi}>
          <div className="jr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="jr-modal-h">
              <Sparkles size={16} color="var(--gold)" /> 粘贴官方名单 · AI 结构化导入
              <span className="x" onClick={closeAi}><X size={16} /></span>
            </div>
            <div className="jr-modal-b">
              <div className="jr-modal-hint">
                把中科院《国际期刊预警名单》官方页面的文本整段粘贴到下方（含刊名/ISSN/原因均可）。AI 只把你提供的权威文本整理成结构化条目，<b>不会新增或臆造</b>任何期刊；生成后请先核对预览，再确认导入。需先在「设置 → 大模型」配置可用模型。
              </div>
              <textarea
                className="jr-ta"
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder={"例如：\nWireless Personal Communications  0929-6212  论文工厂\nNatural Resources Forum  0165-0203  论文工厂\n……"}
              />
              {aiPreview && (
                <div className="jr-prev">
                  <div className="jr-prev-h">预览 · 共 {aiPreview.length} 条（确认无误再导入）</div>
                  {aiPreview.map((e, i) => (
                    <div key={i} className="jr-prev-i">
                      <span className="t">{e.title}</span>
                      <span className="m">{e.issn || "—"}{e.reason ? " · " + e.reason : ""}{e.year ? " · " + e.year : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="jr-modal-f">
              <span className="sp">来源须为官方权威文本，导入后覆盖既有导入项并与内置合并。</span>
              <button className="jr-btn" onClick={aiStructure} disabled={aiBusy || !aiText.trim()}>
                {aiBusy && !aiPreview ? <Loader2 size={12} className="jr-spin" /> : <Sparkles size={12} />} AI 整理预览
              </button>
              <button className="jr-go" onClick={aiConfirmImport} disabled={aiBusy || !aiPreview || !aiPreview.length}>
                {aiBusy && aiPreview ? <Loader2 size={13} className="jr-spin" /> : <Check size={13} />} 确认导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
