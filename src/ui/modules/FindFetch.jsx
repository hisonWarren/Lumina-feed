// Lumina Feed · 检索取文 (Find & Fetch) —— patch: find_fetch
// 定位某一篇 → 取来全文 PDF → 入库(记 provenance)。是"查找一篇"，非"检索语料库"。
// live(有引擎) 时走 bridge.searchOnline / bridge.fetchFullText；无引擎时用内置 mock 预览。
import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, FileDown, BookOpen, Bookmark, ExternalLink, Check, AlertTriangle, X, Loader, Sparkles, Calendar, ArrowUpDown, ChevronDown, Info, Quote } from "lucide-react";
import { bridge, hasBackend } from "../lumina-bridge.js";
import { isDoi, normDoi, escapeRe } from "../lib-store.js";
import { STYLES, formatCitation } from "../cite.js";
import SummaryDrawer from "./SummaryDrawer.jsx";
import FetchBadges from "../FetchBadges.jsx";
import { isFetched, fetchProgressUi } from "../fetch-meta.js";

// 预览用 mock（无引擎时）
const MOCK = [
  { id: "m1", title: "Empagliflozin in Acute Myocardial Infarction: A Multicenter Randomized Trial", authors: ["Hoffmann R", "Sato K", "Liu Y"], journal: "New England Journal of Medicine", year: 2026, type: "rct", preprint: false, retracted: false, oa: "green", oaUrl: null, doi: "10.1056/NEJMoa2601234", abstract: "We randomly assigned 4120 patients with acute myocardial infarction…", matched: ["myocardial", "randomized"] },
  { id: "m2", title: "Microglial TREM2 signaling gates synaptic pruning in neuroinflammation", authors: ["Alvarez M", "Chen W"], journal: "bioRxiv", year: 2026, type: "preprint", preprint: true, retracted: false, oa: "gold", oaUrl: "https://example.org/m2.pdf", doi: "10.1101/2026.06.20.598123", abstract: "These findings have not yet been peer reviewed.", matched: ["microglia"] },
  { id: "m3", title: "Long-term outcomes after transcatheter versus surgical aortic valve replacement", authors: ["Becker T", "Cohen R"], journal: "JAMA Cardiology", year: 2025, type: "cohort", preprint: false, retracted: false, oa: "closed", oaUrl: null, doi: "10.1001/jamacardio.2025.4471", abstract: "Observational cohort of 6230 patients…", matched: ["aortic valve"] },
  { id: "m4", title: "Hydroxychloroquine for prevention of COVID-19 (RETRACTED)", authors: ["Doe A", "Smith B"], journal: "J Clin Trials", year: 2024, type: "rct", preprint: false, retracted: true, oa: "gold", oaUrl: "https://example.org/m4.pdf", doi: "10.1000/jct.2024.0099", abstract: "This article has been retracted.", matched: ["prevention"] },
];

function hi(text, terms) {
  if (!terms || !terms.length || !text) return text;
  const low = terms.map((t) => t.toLowerCase());
  const re = new RegExp("(" + terms.map((t) => escapeRe(t)).join("|") + ")", "ig");
  return text.split(re).map((part, i) => (low.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>));
}

const FIELD_OPTS = [
  { id: "all", label: "不限" },
  { id: "title", label: "标题" },
  { id: "abstract", label: "摘要" },
  { id: "tiab", label: "标题+摘要" },
  { id: "author", label: "作者" },
  { id: "journal", label: "期刊" },
];

const FF_CSS = `
.ff-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px}
.ff-tool{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.ff-tool:hover{border-color:var(--gold);color:var(--gold)}
.ff-tool.on{border-color:var(--gold);color:var(--gold)}
.ff-syntax{position:relative}
.ff-sx-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:20;width:300px;max-width:calc(100vw - 40px);background:var(--raise,var(--surf));border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.16));padding:11px 12px;font-size:11.5px;line-height:1.7;color:var(--ink2)}
.ff-sx-pop code{font-family:'Space Mono',monospace;font-size:10.5px;background:var(--surf2);border:1px solid var(--line2);border-radius:4px;padding:1px 5px;color:var(--ink)}
.ff-sort{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:12px;color:var(--ink3)}
.ff-field-wrap{position:relative;flex-shrink:0;border-right:1px solid var(--line2);margin-right:6px;padding-right:4px}
.ff-field-btn{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--ink2);font-family:inherit;font-size:12.5px;padding:5px 8px 5px 4px;cursor:pointer;outline:none;min-width:76px;line-height:1.35}
.ff-field-btn:hover,.ff-field-btn.on{color:var(--gold)}
.ff-field-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:25;min-width:156px;background:var(--raise,var(--surf));border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.16));padding:6px;display:flex;flex-direction:column;gap:3px}
.ff-field-opt{display:flex;align-items:center;justify-content:space-between;gap:8px;border:none;background:transparent;color:var(--ink2);text-align:left;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;line-height:1.4}
.ff-field-opt:hover{background:var(--surf2);color:var(--gold)}
.ff-field-opt.on{color:var(--gold);background:color-mix(in srgb,var(--gold) 10%,transparent)}
.ff-track{max-width:958px;margin:0 auto;width:100%}
.ff-sources{display:inline-flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 16px;padding:9px 13px;width:fit-content;max-width:100%;background:var(--surf2);border:1px solid var(--line);border-radius:11px}
.ff-src-label{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ink3);font-weight:600;margin-right:3px}
.ff-src-label svg{color:var(--ink3)}
.ff-src{font-family:'Space Mono',monospace;font-size:10.5px;padding:3px 8px;border-radius:7px;border:1px solid var(--line2);color:var(--ink3);background:var(--surf2)}
.ff-src.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.ff-src.err{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent)}
.ff-src.pending{opacity:.7}
.ff-more{display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;color:var(--ink3);font-size:12.5px}
.ff-sort select{border:1px solid var(--line2);background:var(--surf);color:var(--ink);border-radius:8px;padding:5px 8px;font-size:12px;font-family:inherit;cursor:pointer;outline:none}
.ff-sort select:focus{border-color:var(--gold)}
.ff-year{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--ink2)}
.ff-yin{width:80px;border:1px solid var(--line2);border-radius:8px;padding:6px 9px;font-size:12px;font-family:'Space Mono',monospace;background:var(--surf);color:var(--ink);outline:none}
.ff-yin:focus{border-color:var(--gold)}
.ff-year-h{flex-basis:100%;font-size:10.5px;color:var(--ink4);line-height:1.5}
.ff-cites{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line2)}
.ff-cite{border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:5px 10px;font-size:11.5px;cursor:pointer;font-family:'Space Mono',monospace}
.ff-cite:hover{border-color:var(--gold);color:var(--gold)}
`;

// 仅对已得 ~30 条短表做呈现层重排（非分面/非收窄/非分页）；默认最新优先（引擎已按日期降序）。
function sortResults(list, by) {
  const arr = (list || []).slice();
  if (by === "oldest") arr.sort((a, b) => (a.year || 0) - (b.year || 0));
  else if (by === "title") arr.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  else if (by === "author") arr.sort((a, b) => String((a.authors && a.authors[0]) || "").localeCompare(String((b.authors && b.authors[0]) || "")));
  else arr.sort((a, b) => (b.year || 0) - (a.year || 0));
  return arr;
}

let _searchSeq = 0;
export default function FindFetch({ fetchedMeta, fetchingMeta, fetchTick, onFetch, onReadPaper, onSave, inLibFn, pushToast }) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [recent, setRecent] = useState([]);
  const [sel, setSel] = useState(null);
  const [yearOpen, setYearOpen] = useState(false);
  const [sxOpen, setSxOpen] = useState(false);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [field, setField] = useState("all");
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [perSource, setPerSource] = useState(null);
  const curReq = useRef(0);
  const [citeFor, setCiteFor] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current && ref.current.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!fieldMenuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setFieldMenuOpen(false); };
    const onDown = (e) => { if (!(e.target && e.target.closest && e.target.closest(".ff-field-wrap"))) setFieldMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [fieldMenuOpen]);

  const run = async (val) => {
    const term = (val !== undefined ? val : q).trim();
    if (!term) return;
    if (val !== undefined) setQ(val);
    setLoading(true); setErr(null); setResults([]); setPerSource(null);
    setRecent((r) => [term, ...r.filter((x) => x !== term)].slice(0, 6));
    const filters = {};
    const yf = parseInt(yearFrom, 10), yt = parseInt(yearTo, 10);
    if (!Number.isNaN(yf)) filters.yearFrom = yf;
    if (!Number.isNaN(yt)) filters.yearTo = yt;
    // 字段范围：把所选字段并入查询（DOI 直达不加；已含 [..] 标签不重复）
    const searchTerm = (field !== "all" && !isDoi(term) && !term.includes("[")) ? (term + " [" + field + "]") : term;
    const reqId = ++_searchSeq;
    curReq.current = reqId;
    try {
      if (hasBackend() && bridge.searchOnlineStream) {
        // 渐进式：每个开放源返回即增量显示（去重在引擎侧），慢源不拖累首屏
        const streamed = await new Promise((resolve) => {
          let done = false;
          const stop = bridge.searchOnlineStream(searchTerm, filters, reqId, (ev) => {
            if (!ev || ev.reqId !== curReq.current) return;
            if (Array.isArray(ev.papers)) setResults(ev.papers);
            if (ev.perSource) setPerSource(ev.perSource);
            if (ev.done && !done) { done = true; stop && stop(); resolve(true); }
          });
          if (!stop) resolve(false); // 旧版预载/无流式支持 → 回落
        });
        if (!streamed && curReq.current === reqId) {
          const r = await bridge.searchOnline(searchTerm, filters);
          setResults((r && r.papers) || []); setPerSource((r && r.perSource) || null);
        }
      } else if (hasBackend()) {
        const r = await bridge.searchOnline(searchTerm, filters);
        if (curReq.current === reqId) { setResults((r && r.papers) || []); setPerSource((r && r.perSource) || null); }
      } else {
        await new Promise((res) => setTimeout(res, 380));
        const t = term.toLowerCase();
        const inField = (p) => field === "title" ? p.title.toLowerCase().includes(t)
          : field === "author" ? p.authors.join(" ").toLowerCase().includes(t)
          : field === "abstract" ? (p.abstract || "").toLowerCase().includes(t)
          : field === "journal" ? (p.journal || "").toLowerCase().includes(t)
          : (p.title + " " + p.abstract + " " + p.authors.join(" ")).toLowerCase().includes(t);
        let list = isDoi(term) ? MOCK.filter((p) => p.doi.toLowerCase() === normDoi(term).toLowerCase()) : MOCK.filter(inField);
        if (filters.yearFrom) list = list.filter((p) => !p.year || p.year >= filters.yearFrom);
        if (filters.yearTo) list = list.filter((p) => !p.year || p.year <= filters.yearTo);
        if (curReq.current === reqId) setResults(list);
      }
      if (curReq.current === reqId) setSubmitted(term);
    } catch (e) {
      if (curReq.current === reqId) { setErr("检索失败，请稍后重试。"); setResults([]); }
    } finally { if (curReq.current === reqId) setLoading(false); }
  };

  const clear = () => { setQ(""); setSubmitted(""); setResults([]); ref.current && ref.current.focus(); };
  const copyCite = (style, p) => { try { const t = formatCitation(style, p); navigator.clipboard && navigator.clipboard.writeText(t); pushToast && pushToast("已复制 " + style.toUpperCase() + " 引用"); } catch (e) { /* noop */ } };
  const openDoi = (doi) => { if (hasBackend() && window.luminaApi && window.luminaApi.openExternal) window.luminaApi.openExternal("https://doi.org/" + doi); else window.open("https://doi.org/" + doi, "_blank"); };
  const doi = isDoi(q);
  const shown = useMemo(() => sortResults(results, sortBy), [results, sortBy]);
  const fieldLabel = (FIELD_OPTS.find((o) => o.id === field) || FIELD_OPTS[0]).label;

  return (
    <div className="ff">
      <style>{FF_CSS}</style>
      <div className="ff-head">
        <div className="ff-bar">
          <Search size={16} />
          <div className="ff-field-wrap">
            <button type="button" className={"ff-field-btn" + (fieldMenuOpen ? " on" : "")} aria-label="检索字段" aria-haspopup="listbox" aria-expanded={fieldMenuOpen} onClick={() => setFieldMenuOpen((v) => !v)}>
              {fieldLabel}<ChevronDown size={13} />
            </button>
            {fieldMenuOpen && (
              <div className="ff-field-menu" role="listbox" aria-label="检索范围">
                {FIELD_OPTS.map((o) => (
                  <button key={o.id} type="button" role="option" aria-selected={field === o.id} className={"ff-field-opt" + (field === o.id ? " on" : "")}
                    onClick={() => { setField(o.id); setFieldMenuOpen(false); }}>
                    {o.label}{field === o.id ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(); else if (e.key === "Escape") clear(); }}
            placeholder={doi ? "已识别 DOI — 回车直达原文" : "粘贴 DOI，或输入标题 / 作者 / 关键词找到那一篇"} />
          {doi && <span className="ff-doitag">DOI</span>}
          {q && <button className="ff-clr" onClick={clear} title="清除"><X size={14} /></button>}
        </div>
        {recent.length > 0 && !submitted && (
          <div className="ff-recent"><span className="ff-rl">最近</span>{recent.map((t) => <button key={t} className="ff-chip" onClick={() => run(t)}>{t.length > 30 ? t.slice(0, 30) + "…" : t}</button>)}</div>
        )}
        <div className="ff-tools">
          <div className="ff-syntax">
            <button className={"ff-tool" + (sxOpen ? " on" : "")} onClick={() => setSxOpen((v) => !v)} aria-expanded={sxOpen}><Info size={13} /> 检索语法</button>
            {sxOpen && (
              <div className="ff-sx-pop">
简单检索用左侧「范围」下拉即可；高级可手写字段标签与布尔（不写默认全字段按相关度）：<br />
                <code>心梗 [tiab] AND 心衰 [title]</code><br />
                <code>Smith [author] AND apraxia [title]</code><br />
                <code>[title]</code>/<code>[ti]</code> 标题 · <code>[abstract]</code>/<code>[ab]</code> 摘要 · <code>[tiab]</code> 标题+摘要 · <code>[author]</code>/<code>[au]</code> 作者 · <code>[journal]</code> 期刊/ISSN · <code>[mesh]</code> 主题词；布尔 <code>AND</code> / <code>OR</code>。DOI 直接粘贴自动直达。
              </div>
            )}
          </div>
          <button className={"ff-tool" + (yearOpen ? " on" : "")} onClick={() => setYearOpen((v) => !v)} aria-expanded={yearOpen}><Calendar size={13} /> 年份{(yearFrom || yearTo) ? ("：" + (yearFrom || "…") + "–" + (yearTo || "…")) : ""} <ChevronDown size={12} /></button>
          {submitted && shown.length > 0 && (
            <label className="ff-sort"><ArrowUpDown size={13} /> 排序
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="结果排序">
                <option value="newest">最新优先</option>
                <option value="oldest">最早优先</option>
                <option value="title">标题 A–Z</option>
                <option value="author">第一作者 A–Z</option>
              </select>
            </label>
          )}
        </div>
        {yearOpen && (
          <div className="ff-year">
            <span>发表年份</span>
            <input type="number" className="ff-yin" placeholder="从" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
            <span>–</span>
            <input type="number" className="ff-yin" placeholder="至" value={yearTo} onChange={(e) => setYearTo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
            <button className="ff-chip" onClick={() => run()}>应用</button>
            {(yearFrom || yearTo) && <button className="ff-chip" onClick={() => { setYearFrom(""); setYearTo(""); }}>清除</button>}
            <span className="ff-year-h">仅按发表年份约束——非数据库分面；要筛选你自己那批论文，请到「我的文献」。</span>
          </div>
        )}
      </div>

      <div className="ff-results">
        {submitted && perSource && Object.keys(perSource).length > 0 && (
          <div className="ff-track">
            <div className="ff-sources">
              <span className="ff-src-label">命中来源</span>
              {Object.entries(perSource).map(([src, stt]) => <span key={src} className={"ff-src " + (stt && stt.ok ? "ok" : "err")} title={stt && stt.error ? String(stt.error) : ""}>{src} {stt && stt.ok ? stt.count : "✕"}</span>)}
            </div>
          </div>
        )}
        {loading && results.length === 0 ? (
          <div className="ff-empty"><Loader size={26} className="ff-spin" /><h2>正在定位…</h2><p>跨开放学术源检索中——边找边显示。</p></div>
        ) : err ? (
          <div className="ff-empty"><AlertTriangle size={24} /><h2>{err}</h2></div>
        ) : !submitted ? (
          <div className="ff-empty">
            <Search size={28} strokeWidth={1.6} />
            <h2>找到那篇，然后拿来用</h2>
            <p>这不是数据库检索——它帮你<b>定位某一篇</b>并取来全文。粘贴 DOI 直达原文，或用标题、作者、关键词找到它。命中后一键获取 PDF（多源自动尝试）。</p>
            <div className="ff-hint">
              <span className="ff-chip ff-hint-only">粘贴 DOI 回车直达</span>
              <span className="ff-chip ff-hint-only">或输入标题 / 作者 / 关键词</span>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="ff-empty"><Search size={24} /><h2>未找到匹配</h2><p>换个关键词，或核对 DOI 是否完整。</p></div>
        ) : (
          <>
          {shown.map((p) => {
            const meta = fetchedMeta[p.id];
            const got = isFetched(meta);
            const fmeta = fetchingMeta[p.id];
            const isFetching = !!fmeta;
            const prog = isFetching ? fetchProgressUi(fmeta, Date.now()) : null;
            const saved = inLibFn(p.id);
            return (
              <div className="ff-card" key={p.id}>
                <div className="ff-title" onClick={() => openDoi(p.doi)}>{hi(p.title, p.matched)}</div>
                <div className="ff-meta">{(p.authors || []).slice(0, 4).join(", ")}{(p.authors || []).length > 4 ? " et al." : ""}</div>
                <button className="ff-doi" onClick={() => openDoi(p.doi)} title="在浏览器打开"><span>{p.doi}</span><ExternalLink size={11} /></button>
                <FetchBadges p={p} fetchedMeta={meta} />
                <div className="ff-actions">
                  <button className={"ff-act ff-ft" + (got ? " on" : "") + (isFetching ? " loading" : "")} disabled={isFetching}
                    onClick={() => onFetch(p)}>
                    {isFetching ? <><Loader size={13} className="ff-spin" /> {prog.stageText}{prog.elapsed >= 5 ? <span className="ff-soon"> · {prog.elapsed}s</span> : null}</> : got ? <><Check size={13} /> 已取全文</> : <><FileDown size={13} /> 获取全文</>}
                  </button>
                  {got && <button className="ff-act" onClick={() => onReadPaper(p)}><BookOpen size={13} /> 阅读</button>}
                  <button className="ff-act" onClick={() => setSel(p)}><Sparkles size={13} /> AI 总结</button>
                  <button className={"ff-act" + (saved ? " on" : "")} onClick={() => onSave(p)}><Bookmark size={13} fill={saved ? "currentColor" : "none"} /> {saved ? "已收藏" : "收藏"}</button>
                  <button className={"ff-act" + (citeFor === p.id ? " on" : "")} onClick={() => setCiteFor(citeFor === p.id ? null : p.id)} title="复制引用（含 BibTeX）"><Quote size={13} /> 引用 <ChevronDown size={12} /></button>
                </div>
                {citeFor === p.id && (
                  <div className="ff-cites">
                    {STYLES.map((st) => <button key={st[0]} className="ff-cite" onClick={() => copyCite(st[0], p)}>{st[1]}</button>)}
                  </div>
                )}
                {p.oa === "closed" && !got && (
                  <div className="ff-wall">未标注开放获取。仍会尝试备用库与镜像站；若均失败，可经<b>机构订阅</b>或向作者索取。</div>
                )}
              </div>
            );
          })}
          {loading && <div className="ff-more"><Loader size={14} className="ff-spin" /> 还在从其他来源获取…</div>}
          </>
        )}
      </div>

      {sel && (
        <SummaryDrawer
          paper={sel}
          fetchedMeta={fetchedMeta[sel.id]}
          fetchingMeta={fetchingMeta[sel.id]}
          onFetch={() => onFetch(sel)}
          onReadPaper={() => onReadPaper(sel)}
          onClose={() => setSel(null)}
          pushToast={pushToast}
        />
      )}
    </div>
  );
}
