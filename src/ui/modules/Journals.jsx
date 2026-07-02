// Lumina Feed · 期刊信息（尽职调查 / 避坑工具）
// 定位：分区 + 预警 + OA 正规性为主；影响因子仅给 OpenAlex 类指标 + 官方页跳转（不伪造 JIF）。
import React, { useState, useCallback, useEffect, useRef } from "react";
import { bridge } from "../lumina-bridge.js";
import {
  Search, RefreshCw, ExternalLink, AlertTriangle, ShieldCheck, BadgeCheck,
  Loader2, Database, Upload, X, Info, BookOpenCheck, Sparkles, Check,
} from "lucide-react";

const CSS = `
.jr{flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding:16px 20px 28px;scrollbar-gutter:stable}
.jr-head{max-width:920px;margin:0 auto;width:100%}
.jr-h1{font-family:'Source Serif 4',Georgia,serif;font-size:19px;font-weight:600;color:var(--ink);margin:2px 0 3px}
.jr-sub{font-size:12.5px;color:var(--ink3);margin-bottom:14px;line-height:1.5}
.jr-bar{display:flex;align-items:center;gap:10px;border:1px solid var(--line2);border-radius:12px;padding:10px 14px;background:var(--surf)}
.jr-bar input{flex:1;border:none;outline:none;font-size:14px;font-family:inherit;background:transparent;color:var(--ink)}
.jr-go{display:inline-flex;align-items:center;gap:6px;border:none;background:var(--gold);color:#fff;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.jr-go:disabled{opacity:.6;cursor:default}
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
.jr-tags{display:flex;flex-wrap:wrap;gap:7px;padding:12px 20px 4px}
.jr-q{display:inline-flex;align-items:center;gap:5px;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;border-radius:8px;padding:4px 10px;color:#fff}
.jr-q.Q1{background:#2C8A60}.jr-q.Q2{background:#2f7db8}.jr-q.Q3{background:#BE7A18}.jr-q.Q4{background:#BC3B2B}
.jr-tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-family:'Space Mono',monospace;border-radius:8px;padding:4px 9px;border:1px solid var(--line2);color:var(--ink2);background:var(--surf2)}
.jr-tag.oa{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.jr-tag.doaj{color:var(--gold);border-color:var(--gold-line)}
.jr-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:14px}
.jr-m{background:var(--surf);padding:14px 18px}
.jr-mv{font-family:'Space Mono',monospace;font-size:22px;font-weight:700;color:var(--ink);line-height:1}
.jr-mv.dim{color:var(--ink4);font-size:15px;font-weight:500}
.jr-ml{font-size:11.5px;color:var(--ink2);margin-top:7px;display:flex;align-items:center;gap:4px}
.jr-msrc{font-size:9.5px;color:var(--ink4);font-family:'Space Mono',monospace;margin-top:3px}
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
.jr-cand-m{font-size:11px;color:var(--ink4);font-family:'Space Mono',monospace}
.jr-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:44px 24px;text-align:center;color:var(--ink2)}
.jr-empty h3{margin:0;font-size:16px;font-family:'Source Serif 4',Georgia,serif;color:var(--ink)}
.jr-empty p{margin:0;font-size:12.5px;color:var(--ink3);max-width:440px;line-height:1.6}
.jr-ds{max-width:920px;margin:18px auto 0;width:100%;border:1px solid var(--line);border-radius:14px;background:var(--surf2);padding:14px 16px}
.jr-ds-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px}
.jr-ds-hint{font-size:11.5px;color:var(--ink3);line-height:1.5;margin-bottom:12px}
.jr-ds-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surf);margin-bottom:8px}
.jr-ds-info{flex:1;min-width:0}
.jr-ds-name{font-size:13px;color:var(--ink);font-weight:500}
.jr-ds-meta{font-size:11px;color:var(--ink4);font-family:'Space Mono',monospace;margin-top:3px}
.jr-ds-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.jr-ds-dot.on{background:var(--ok)}.jr-ds-dot.off{background:var(--ink4)}
.jr-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.jr-btn:hover{border-color:var(--gold);color:var(--gold)}
.jr-btn:disabled{opacity:.6;cursor:default}
.jr-spin{animation:jrspin .8s linear infinite}
@keyframes jrspin{to{transform:rotate(360deg)}}
.jr-note{font-size:11px;color:var(--ink4);line-height:1.6;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
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

export default function Journals({ pushToast }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);
  const sjFileRef = useRef(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState(null);

  const refreshDatasets = useCallback(async () => {
    const ds = await bridge.journalDatasets();
    setDatasets(Array.isArray(ds) ? ds : []);
  }, []);

  useEffect(() => { void refreshDatasets(); }, [refreshDatasets]);

  const run = useCallback(async (query) => {
    const term = String(query ?? q).trim();
    if (!term) return;
    setLoading(true);
    setProfile(null);
    try {
      const r = await bridge.journalSearch(term);
      setProfile(r || { ok: false, query: term, error: "no_result" });
    } catch {
      setProfile({ ok: false, query: term, error: "failed" });
    } finally {
      setLoading(false);
    }
  }, [q]);

  const onExample = useCallback((ex) => { setQ(ex); void run(ex); }, [run]);

  const updateScimago = useCallback(async () => {
    setBusy("scimago");
    const r = await bridge.journalUpdateScimago();
    setBusy("");
    if (r?.ok) { pushToast && pushToast("分区数据已更新"); await refreshDatasets(); }
    else pushToast && pushToast("更新失败：" + (r?.error || "网络错误"));
  }, [pushToast, refreshDatasets]);

  const importScimagoFile = useCallback(async (file) => {
    if (!file) return;
    setBusy("scimago");
    try {
      const text = await file.text();
      const r = await bridge.journalImportScimago(text);
      if (r?.ok) { pushToast && pushToast("分区数据已导入 · " + (r.info?.count || 0) + " 条"); await refreshDatasets(); }
      else pushToast && pushToast("导入失败：" + (r?.error || "格式错误"));
    } catch { pushToast && pushToast("读取文件失败"); }
    finally { setBusy(""); }
  }, [pushToast, refreshDatasets]);

  const importWarningFile = useCallback(async (file) => {
    if (!file) return;
    setBusy("warning");
    try {
      const text = await file.text();
      const r = await bridge.journalImportWarning(text);
      if (r?.ok) { pushToast && pushToast("预警名单已导入 · " + (r.info?.count || 0) + " 条"); await refreshDatasets(); }
      else pushToast && pushToast("导入失败：" + (r?.error || "格式错误"));
    } catch { pushToast && pushToast("读取文件失败"); }
    finally { setBusy(""); }
  }, [pushToast, refreshDatasets]);

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
  const bestQ = sj?.bestQuartile && Q_COLOR[sj.bestQuartile] ? sj.bestQuartile : null;
  const issn = p ? issnForUrl(p) : "";

  return (
    <div className="jr">
      <style>{CSS}</style>
      <div className="jr-head">
        <div className="jr-h1">期刊信息</div>
        <div className="jr-sub">
          输入刊名或 ISSN，查看分区、预警状态、开放获取正规性与类影响因子。定位为投稿前尽职调查工具——分区/预警来自可溯来源，影响因子仅提供 OpenAlex 类指标与官方页跳转，不代替官方 JIF/中科院分区。
        </div>
        <div className="jr-bar">
          <Search size={17} color="var(--ink3)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="期刊名称 或 ISSN（如 Nature / 0028-0836）"
          />
          {q && <button className="jr-chip" onClick={() => { setQ(""); setProfile(null); }} title="清空"><X size={13} /></button>}
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
                {bestQ && <span className={"jr-q " + bestQ}>{bestQ} · SCImago</span>}
                {p.isOa && <span className="jr-tag oa"><ShieldCheck size={12} /> 开放获取</span>}
                {p.isInDoaj && <span className="jr-tag doaj"><BadgeCheck size={12} /> DOAJ 收录</span>}
                {!p.warning && <span className="jr-tag" style={{ color: "var(--ok)", borderColor: "color-mix(in srgb,var(--ok) 30%,transparent)" }}><BookOpenCheck size={12} /> 未在预警名单</span>}
              </div>

              <div className="jr-metrics">
                <Metric
                  value={p.impact2yr != null ? p.impact2yr.toFixed(2) : "—"}
                  dim={p.impact2yr == null}
                  label="类影响因子"
                  hint="OpenAlex 近两年篇均被引（2yr mean citedness），非 Clarivate JIF"
                  source="OpenAlex · live"
                />
                <Metric
                  value={sj?.sjr != null ? sj.sjr.toFixed(3) : "—"}
                  dim={sj?.sjr == null}
                  label="SJR"
                  hint="SCImago Journal Rank"
                  source={sj?.year ? `SCImago ${sj.year}` : (bestQ ? "SCImago" : "需更新分区数据")}
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
                {issn && <button className="jr-act" onClick={() => openExt(`https://mjl.clarivate.com/search-results?issn=${issn}`)}><ExternalLink size={13} /> 官方 JIF / JCR（Web of Science）</button>}
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
            <p>分区（SCImago）与预警名单为本地数据集，需手动更新以保证来源可靠；类影响因子、H 指数、OA/DOAJ 状态每次实时查询。</p>
          </div>
        </div>
      )}

      <div className="jr-ds">
        <div className="jr-ds-h"><Database size={15} /> 数据集 · 手动更新</div>
        <div className="jr-ds-hint">
          在线拉取但不自动联网；由你决定何时更新，来源清晰可溯。类影响因子 / H 指数 / OA / DOAJ 无需更新（实时查询）。
        </div>
        {datasets.map((d) => (
          <div key={d.id} className="jr-ds-row">
            <span className={"jr-ds-dot " + (d.present ? "on" : "off")} />
            <div className="jr-ds-info">
              <div className="jr-ds-name">{d.label}</div>
              <div className="jr-ds-meta">
                {d.present
                  ? `${d.count != null ? d.count.toLocaleString() + " 条 · " : ""}${d.year ? d.year + " 版 · " : ""}${d.updatedAt ? "更新于 " + fmtDate(d.updatedAt) : "内置"}`
                  : "未加载"}
              </div>
            </div>
            {d.sourceHomepage && (
              <button className="jr-btn" onClick={() => openExt(d.sourceHomepage)} title="官方来源"><ExternalLink size={12} /> 来源</button>
            )}
            {d.id === "scimago" && (
              <>
                <input ref={sjFileRef} type="file" accept=".csv,.xls,text/csv,application/vnd.ms-excel" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importScimagoFile(f); }} />
                <button className="jr-btn" onClick={() => sjFileRef.current && sjFileRef.current.click()} disabled={busy === "scimago"} title="从 scimagojr.com 下载的 CSV 导入（最稳）">
                  <Upload size={12} /> 导入 CSV
                </button>
                <button className="jr-btn" onClick={updateScimago} disabled={busy === "scimago"}>
                  {busy === "scimago" ? <Loader2 size={12} className="jr-spin" /> : <RefreshCw size={12} />} 在线更新
                </button>
              </>
            )}
            {d.id === "warning" && (
              <>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importWarningFile(f); }} />
                <button className="jr-btn" onClick={() => setAiOpen(true)} disabled={busy === "warning"} title="粘贴官方名单文本，AI 只做结构化排版（不臆造），预览后导入">
                  <Sparkles size={12} /> 粘贴导入
                </button>
                <button className="jr-btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy === "warning"}>
                  {busy === "warning" ? <Loader2 size={12} className="jr-spin" /> : <Upload size={12} />} 导入 JSON
                </button>
              </>
            )}
          </div>
        ))}
        <div className="jr-note">
          说明：官方 JIF、JCR 分区、中科院官方分区受商业授权约束，本工具不抓取其数值，仅提供官方页跳转。SCImago 数据（CC BY-NC）来源 scimagojr.com——「在线更新」若被其反爬拦截，可在官网点「Download data」得到 CSV 后用「导入 CSV」（最稳）。预警名单已内置中科院 2025 版（5 本，经多来源核对）。来年新版发布后：推荐「粘贴导入」——把官方名单文本粘进来，AI 只做结构化排版（不新增/不臆造），预览确认后导入；新旧年度会自动合并，旧年度降级为黄色「历史」提示（官方规则：整改移出后不再是预警期刊，故只保留最新年度为当前预警）。
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
