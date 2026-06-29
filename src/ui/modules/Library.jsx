// Lumina Feed · 我的文献（工作集）—— patch: library
// 渲染层：对"你收藏/取过的那批"做 易搜(客户端) / 易引(多样式 + 导出) / 易重开。
// FTS5 全文索引（PDF 全文 + AI 总结 + 批注）属引擎层（doc 04 §4），需 electron/ 引擎；本模块对工作集元数据做客户端检索，
// 并提供完整的引用与 .bib/.ris/CSL 导出（纯渲染层、喂 Zotero 不锁定）。定位为工作集；支持单层自定义分组（list）——类似扁平文件夹，一篇可进多组；不做嵌套目录树 / 标签体系 / 云端账号 / Word 插件（红线/01-C）。
import React, { useState, useMemo, useEffect, useRef } from "react";
import { bridge } from "../lumina-bridge.js";
import { BookMarked, Search, Copy, Download, Trash2, ChevronDown, BookOpen, Quote, Layers, FolderPlus, Check, X, Folder, Sparkles, Lightbulb, FileDown, Loader, Pencil } from "lucide-react";
import { STYLES, formatCitation, exportBib, exportRis, exportCslJson } from "../cite.js";
import { isFetched, oaStatusBadge, fetchProgressUi } from "../fetch-meta.js";
import { formatAuthors, normalizeAuthors } from "../lib/format-authors.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { loadJsonPref, patchJsonPref, corpusCacheKey } from "../ui-prefs.js";

const LIB_PREFS_KEY = "lumina_library_prefs";
const _libPref0 = loadJsonPref("local", LIB_PREFS_KEY, {});

const PROV_LABEL = { find_fetch: "检索结果", subscription: "订阅", recovered: "本机恢复", "": "未分组" };
const provName = (p) => {
  const raw = p || "";
  if (PROV_LABEL[raw]) return PROV_LABEL[raw];
  if (String(raw).startsWith("subscription:")) return "订阅";
  return raw || "其他";
};

const LIB_CSS = `
.lib{flex:1;min-height:0;display:flex;flex-direction:column}
.lib-head{padding:16px 20px 10px;flex-shrink:0;display:flex;flex-direction:column;gap:12px}
.lib-h1row{display:flex;align-items:center;gap:10px;position:relative}
.lib-h1{font-family:'Source Serif 4',Georgia,serif;font-size:20px;font-weight:600;margin:0;color:var(--ink);display:flex;align-items:center;gap:8px}
.lib-h1 svg{color:var(--gold)}
.lib-count{font-size:12px;font-family:'Space Mono',monospace;color:var(--ink4)}
.lib-export{margin-left:auto;position:relative}
.lib-xbtn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
.lib-xbtn:hover{border-color:var(--gold);color:var(--gold)}
.lib-xbtn:disabled{opacity:.5;cursor:default}
.lib-xmenu{position:absolute;top:calc(100% + 4px);right:0;background:var(--surf);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:4px;display:flex;flex-direction:column;gap:2px;z-index:20;min-width:150px}
.lib-xmenu button{border:none;background:transparent;color:var(--ink2);text-align:left;padding:8px 11px;font-size:12.5px;border-radius:7px;cursor:pointer;font-family:inherit}
.lib-xmenu button:hover{background:var(--surf2);color:var(--gold)}
.lib-bar{display:flex;align-items:center;gap:10px;border:1px solid var(--line2);border-radius:11px;padding:8px 12px;background:var(--surf)}
.lib-bar input{flex:1;border:none;outline:none;font-size:13.5px;font-family:inherit;background:transparent;color:var(--ink)}
.lib-bar svg{color:var(--ink3)}
.lib-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lib-chip{border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.lib-chip:hover{border-color:var(--gold);color:var(--gold)}
.lib-chip.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.lib-sort{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink3)}
.lib-sort select{border:1px solid var(--line2);border-radius:8px;padding:5px 8px;font-size:12px;font-family:inherit;background:var(--surf);color:var(--ink);cursor:pointer}
.lib-body{flex:1;min-height:0;overflow-y:auto;padding:6px 20px 28px}
.lib-group-h{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin:14px 0 8px}
.lib-card{border:1px solid var(--line);border-radius:13px;padding:14px 16px;margin-bottom:11px;background:var(--surf);transition:box-shadow .16s,border-color .16s}
.lib-card:hover{box-shadow:var(--shadow);border-color:var(--line2)}
.lib-title{font-family:'Source Serif 4',Georgia,serif;font-size:15.5px;font-weight:600;line-height:1.4;color:var(--ink)}
.lib-meta{font-size:12.5px;color:var(--ink3);margin-top:5px}
.lib-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.lib-b{font-size:10.5px;font-family:'Space Mono',monospace;color:var(--ink3);background:var(--surf2);border:1px solid var(--line);border-radius:6px;padding:3px 7px}
.lib-b-ret{color:#b42318;background:rgba(180,35,24,.08);border-color:rgba(180,35,24,.25)}
.lib-b-pre{color:#9a6b2e}
.lib-b-oa{color:var(--gold)}
.lib-doi{display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-family:'Space Mono',monospace;font-size:11px;color:var(--gold);background:none;border:none;cursor:pointer;padding:0}
.lib-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.lib-act{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.lib-act:hover{border-color:var(--gold);color:var(--gold)}
.lib-act-del:hover{border-color:#b42318;color:#b42318}
.lib-spin{animation:libspin .8s linear infinite}
@keyframes libspin{to{transform:rotate(360deg)}}
.lib-cites{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line2)}
.lib-cite{border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:5px 10px;font-size:11.5px;cursor:pointer;font-family:'Space Mono',monospace}
.lib-cite:hover{border-color:var(--gold);color:var(--gold)}
.lib-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:54px 24px;text-align:center;color:var(--ink2);min-height:260px}
.lib-empty h2{margin:0;font-size:18px;font-family:'Source Serif 4',Georgia,serif;color:var(--ink)}
.lib-empty p{margin:0;font-size:13.5px;line-height:1.6;max-width:480px}
.lib-act-on{background:rgba(14,124,111,.1);color:var(--gold);border-color:rgba(14,124,111,.3)}
.lib-listbar{display:flex;flex-wrap:wrap;gap:7px;padding:0;align-items:center}
.lib-groupbar{flex-shrink:0;padding:0 20px 10px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--line)}
.lib-groupbar-h{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--ink2);flex-wrap:wrap}
.lib-groupbar-h svg{color:var(--gold);flex-shrink:0}
.lib-groupbar-hint{font-size:11px;font-weight:400;color:var(--ink4);margin-left:4px;flex:1;min-width:200px;line-height:1.45}
.lib-lchip-new{border-style:dashed;color:var(--gold)}
.lib-lchip-new:hover{background:rgba(14,124,111,.06)}
.lib-grp-new-inp{border:1px solid var(--gold);border-radius:999px;padding:5px 12px;font-size:12px;font-family:inherit;background:var(--surf);color:var(--ink);outline:none;min-width:140px;max-width:220px}
.lib-grp-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.lib-grp-badge{font-size:10.5px;color:var(--gold);background:rgba(14,124,111,.08);border:1px solid rgba(14,124,111,.22);border-radius:6px;padding:2px 7px;cursor:pointer;font-family:inherit}
.lib-grp-badge:hover{background:rgba(14,124,111,.14)}
.lib-lc-edit,.lib-lc-del{display:inline-flex;margin-left:2px;border-radius:50%;padding:1px;opacity:.85}
.lib-lc-edit:hover,.lib-lc-del:hover{background:rgba(255,255,255,.25);opacity:1}
.lib-batch-grp{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink3)}
.lib-batch-grp select{border:1px solid var(--line2);border-radius:8px;padding:6px 8px;font-size:12px;font-family:inherit;background:var(--surf);color:var(--ink);cursor:pointer;max-width:180px}
.lib-lchip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit}
.lib-lchip:hover{border-color:var(--gold);color:var(--gold)}
.lib-lchip.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.lib-lc-n{font-family:'Space Mono',monospace;font-size:10.5px;opacity:.8}
.lib-lc-del{display:inline-flex;margin-left:2px;border-radius:50%;padding:1px}
.lib-lc-del:hover{background:rgba(255,255,255,.25)}
.lib-lists{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line2);display:flex;flex-direction:column;gap:8px}
.lib-lists-h{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3)}
.lib-lists-empty{font-size:12px;color:var(--ink4)}
.lib-lists-row{display:flex;flex-wrap:wrap;gap:6px}
.lib-lchip2{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.lib-lchip2:hover{border-color:var(--gold);color:var(--gold)}
.lib-lchip2.on{background:rgba(14,124,111,.12);color:var(--gold);border-color:rgba(14,124,111,.35)}
.lib-lists-new{border:1px solid var(--line2);border-radius:8px;padding:7px 10px;font-size:12.5px;font-family:inherit;background:var(--surf);color:var(--ink);outline:none;max-width:280px}
.lib-lists-new:focus{border-color:var(--gold)}
.lib-card-sel{border-color:var(--gold)}
.lib-cb{width:22px;height:22px;border-radius:6px;border:1.5px solid var(--line2);background:var(--surf);cursor:pointer;display:grid;place-items:center;color:#fff;margin-bottom:8px;padding:0}
.lib-cb.on{background:var(--gold);border-color:var(--gold)}
.lib-corpus-bar{border:1px solid rgba(14,124,111,.3);background:rgba(14,124,111,.05);border-radius:13px;padding:14px 16px;margin-bottom:14px;display:flex;flex-direction:column;gap:10px}
.lib-corpus-barh{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--gold)}
.lib-corpus-tools{display:flex;flex-wrap:wrap;gap:8px}
.lib-corpus-tools button{border:1px solid var(--line2);background:var(--surf);color:var(--ink);border-radius:9px;padding:8px 12px;font-size:12.5px;font-family:inherit;cursor:pointer}
.lib-corpus-tools button:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.lib-corpus-tools button:disabled{opacity:.5;cursor:default}
.lib-corpus-clear{margin-left:auto;color:var(--ink3) !important}
.lib-corpus-note{font-size:11px;color:var(--ink3);line-height:1.5}
.lib-corpus-card{border:1px solid var(--line2);border-left:3px solid var(--gold);background:var(--surf);border-radius:10px;padding:13px 15px;display:flex;flex-direction:column;gap:9px;margin-top:4px}
.lib-corpus-card.inf{border-left-color:var(--rd, #BE7A18)}
.lib-corpus-h{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--ink)}
.lib-corpus-h svg{color:var(--gold)}
.lib-corpus-card.inf .lib-corpus-h svg{color:var(--rd, #BE7A18)}
.lib-corpus-lane{margin-left:auto;font-family:'Space Mono',monospace;font-size:9.5px;letter-spacing:.04em;color:var(--ink3);border:1px solid var(--line2);border-radius:5px;padding:1px 6px}
.lib-corpus-framing{font-size:11.5px;color:var(--ink3);line-height:1.55;background:var(--surf2);border-radius:8px;padding:8px 10px}
.lib-corpus-claim{border-top:1px solid var(--line);padding-top:9px;display:flex;flex-direction:column;gap:6px}
.lib-corpus-claim:first-of-type{border-top:none;padding-top:0}
.lib-corpus-text{font-size:13px;line-height:1.6;color:var(--ink)}
.lib-corpus-refs{display:flex;flex-wrap:wrap;gap:5px}
.lib-corpus-ref{font-size:10.5px;color:var(--ink2);background:var(--surf2);border:1px solid var(--line2);border-radius:6px;padding:2px 7px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lib-corpus-banner{font-size:11px;color:var(--ink4)}
.lib-corpus-refuse{font-size:12.5px;color:var(--ink2);line-height:1.55}
@media (prefers-reduced-motion: reduce){ .lib-chip,.lib-act,.lib-cb,.lib-corpus-tools button,.lib-lchip{transition:none !important} }
`;

function CorpusCard({ env }) {
  if (!env) return null;
  const inf = env.lane === "inference";
  if (env.refused) return <div className="lib-corpus-card"><div className="lib-corpus-refuse">{env.refused.reason}</div></div>;
  return (
    <div className={"lib-corpus-card" + (inf ? " inf" : "")}>
      <div className="lib-corpus-h">{inf ? <Lightbulb size={14} /> : <Layers size={14} />} {env.title}<span className="lib-corpus-lane">{inf ? "推断 · 跨文本归纳" : "证据 · 带出处汇编"}</span></div>
      {env.framing && <div className="lib-corpus-framing">{env.framing}</div>}
      {(env.claims || []).map((c, i) => (
        <div key={i} className="lib-corpus-claim">
          <div className="lib-corpus-text">{c.text}</div>
          {Array.isArray(c.paperRefs) && c.paperRefs.length > 0 && (
            <div className="lib-corpus-refs">{c.paperRefs.map((r, j) => <span key={j} className="lib-corpus-ref" title={r}>{r}</span>)}</div>
          )}
        </div>
      ))}
      {env.banner && <div className="lib-corpus-banner">{env.banner}</div>}
    </div>
  );
}

export default function Library({ lib, lists, onCreateList, onToggleInList, onDeleteList, onRenameList, onAddManyToList, onRemove, onRead, onFetch, fetchedMeta, fetchingMeta = {}, fetchTick = 0, pushToast }) {
  const [query, setQuery] = useState(_libPref0.query || "");
  const [fFulltext, setFFulltext] = useState(!!_libPref0.fFulltext);
  const [fPreprint, setFPreprint] = useState(!!_libPref0.fPreprint);
  const [fOa, setFOa] = useState(!!_libPref0.fOa);
  const [fSummary, setFSummary] = useState(!!_libPref0.fSummary);
  const [fAnno, setFAnno] = useState(!!_libPref0.fAnno);
  const [bodyIds, setBodyIds] = useState(null); // 引擎正文 FTS 命中的 paperId 集（query 变化时取）
  const [sort, setSort] = useState(_libPref0.sort || "recent");
  const [grouped, setGrouped] = useState(!!_libPref0.grouped);
  const [citeFor, setCiteFor] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [activeList, setActiveList] = useState(_libPref0.activeList || null);
  const [listFor, setListFor] = useState(null);
  const [newListName, setNewListName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [topNewName, setTopNewName] = useState("");
  const [editingGroup, setEditingGroup] = useState(null);
  const [editGroupName, setEditGroupName] = useState("");
  const topNewRef = useRef(null);
  const skipCreateBlurRef = useRef(false);
  const skipRenameBlurRef = useRef(false);
  const [selMode, setSelMode] = useState(!!_libPref0.selMode);
  const [sel, setSel] = useState(() => new Set(Array.isArray(_libPref0.sel) ? _libPref0.sel : []));
  const [corpusEnv, setCorpusEnv] = useState(null);
  const [corpusRunning, setCorpusRunning] = useState("");
  const [corpusLastKind, setCorpusLastKind] = useState(_libPref0.corpusLastKind || "corpus_framing");
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(null);
  const LS = lists || [];

  useEffect(() => {
    patchJsonPref("local", LIB_PREFS_KEY, {
      query, fFulltext, fPreprint, fOa, fSummary, fAnno, sort, grouped, activeList, selMode,
      sel: Array.from(sel), corpusLastKind,
    });
  }, [query, fFulltext, fPreprint, fOa, fSummary, fAnno, sort, grouped, activeList, selMode, sel, corpusLastKind]);

  useEffect(() => {
    if (creatingGroup && topNewRef.current) topNewRef.current.focus();
  }, [creatingGroup]);

  const submitCreateGroup = (name, firstId) => {
    const trimmed = String(name || "").trim();
    if (!trimmed || !onCreateList) return;
    const newId = onCreateList(trimmed, firstId);
    setNewListName("");
    setTopNewName("");
    setCreatingGroup(false);
    setListFor(null);
    if (newId && firstId) setActiveList(newId);
    pushToast && pushToast(firstId ? `已建分组「${trimmed}」并加入` : `已建分组「${trimmed}」`);
  };

  const requestDeleteGroup = (L) => {
    if (!L || !onDeleteList) return;
    setDeleteGroupConfirm({ id: L.id, name: L.name });
  };

  const doDeleteGroup = () => {
    if (!deleteGroupConfirm || !onDeleteList) return;
    onDeleteList(deleteGroupConfirm.id);
    if (activeList === deleteGroupConfirm.id) setActiveList(null);
    pushToast && pushToast("分组已删除");
    setDeleteGroupConfirm(null);
  };

  const submitRenameGroup = (lid) => {
    const trimmed = String(editGroupName || "").trim();
    if (!trimmed || !onRenameList) { setEditingGroup(null); return; }
    onRenameList(lid, trimmed);
    setEditingGroup(null);
    pushToast && pushToast("分组已重命名");
  };

  const paperGroups = (pid) => LS.filter((L) => L.ids.includes(pid));

  useEffect(() => {
    const qq = query.trim();
    if (!qq) { setBodyIds(null); return; }
    let alive = true;
    bridge.searchLocal(qq).then((ids) => { if (alive) setBodyIds(new Set(Array.isArray(ids) ? ids : [])); }).catch(() => { if (alive) setBodyIds(null); });
    return () => { alive = false; };
  }, [query]); // 正文检索属引擎；无引擎时返回空集，仍有客户端元数据/总结/批注命中

  const has = (p) => isFetched(fetchedMeta && fetchedMeta[p.id]) || !!(p && p._fetched);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = (lib || []).filter((p) => {
      if (activeList) { const L = LS.find((l) => l.id === activeList); if (!L || !L.ids.includes(p.id)) return false; }
      if (fPreprint && !p.preprint) return false;
      if (fOa && (!p.oa || p.oa === "closed")) return false;
      if (fFulltext && !has(p)) return false;
      if (fSummary && !p.hasSummary) return false;
      if (fAnno && !(p.annoCount > 0)) return false;
      if (!q) return true;
      const hay = `${p.title || ""} ${(p.authors || []).join(" ")} ${p.journal || ""} ${p.abstract || ""} ${p.summary || ""} ${p.annoText || ""}`.toLowerCase();
      return hay.includes(q) || !!(bodyIds && bodyIds.has(p.id)); // 标题/作者/期刊/摘要/总结/批注 或 PDF 正文（引擎 FTS）
    });
    const idx = new Map((lib || []).map((p, i) => [p.id, i]));
    arr = arr.slice().sort((a, b) => {
      if (sort === "year") return (Number(b.year) || 0) - (Number(a.year) || 0);
      if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""));
      return (idx.get(b.id) || 0) - (idx.get(a.id) || 0); // recent：后加入在前
    });
    return arr;
  }, [lib, query, fPreprint, fOa, fFulltext, fSummary, fAnno, bodyIds, sort, fetchedMeta, activeList, LS]);

  const groups = useMemo(() => {
    if (!grouped) return [{ key: "__all", items: view }];
    const m = {};
    view.forEach((p) => { const k = p.provenance || ""; (m[k] = m[k] || []).push(p); });
    return Object.keys(m).map((k) => ({ key: k, items: m[k] }));
  }, [view, grouped]);

  const copyCite = (style, p) => {
    try { const t = formatCitation(style, p); navigator.clipboard && navigator.clipboard.writeText(t); pushToast && pushToast("已复制 " + style.toUpperCase() + " 引用"); } catch (e) { /* noop */ }
  };
  const doExport = (kind) => {
    setExportOpen(false);
    const set = view;
    if (!set.length) { pushToast && pushToast("当前没有可导出的条目"); return; }
    if (kind === "bib") exportBib(set, "lumina");
    else if (kind === "ris") exportRis(set, "lumina");
    else exportCslJson(set, "lumina");
    pushToast && pushToast("已导出 " + set.length + " 条（" + kind.toUpperCase() + "）");
  };

  const toggleSel = (id) => setSel((st) => { const n = new Set(st); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  useEffect(() => {
    if (sel.size < 2) { setCorpusEnv(null); return; }
    let alive = true;
    const kind = corpusLastKind || "corpus_framing";
    const key = corpusCacheKey(kind, sel);
    bridge.readerAnalysisGet(key, kind).then((env) => { if (alive && env) setCorpusEnv(env); }).catch(() => {});
    return () => { alive = false; };
  }, [sel, corpusLastKind]);

  const runCorpus = async (kind) => {
    if (sel.size < 2) return;
    setCorpusLastKind(kind);
    setCorpusRunning(kind);
    setCorpusEnv(null);
    const ids = Array.from(sel);
    const key = corpusCacheKey(kind, ids);
    try {
      const env = await bridge.readerCorpus(kind, ids);
      setCorpusEnv(env || null);
      if (env && !env.refused) bridge.readerAnalysisSave(key, env);
      if (env && env.refused && env.refused.reason) pushToast && pushToast(env.refused.reason);
      else if (!env) pushToast && pushToast("跨篇分析失败");
    } catch (e) { pushToast && pushToast("跨篇分析失败"); }
    finally { setCorpusRunning(""); }
  };

  const Card = (p) => {
    const got = has(p);
    const fmeta = fetchingMeta[p.id];
    const isFetching = !!(fmeta && fmeta.startedAt);
    const prog = isFetching ? fetchProgressUi(fmeta, Date.now()) : null;
    return (
    <div className={"lib-card" + (selMode && sel.has(p.id) ? " lib-card-sel" : "")} key={p.id}>
      {selMode && <button role="checkbox" aria-checked={sel.has(p.id)} className={"lib-cb" + (sel.has(p.id) ? " on" : "")} onClick={() => toggleSel(p.id)} aria-label="选择本篇做跨篇分析">{sel.has(p.id) ? <Check size={14} /> : null}</button>}
      <div className="lib-title">{p.title || "(无标题)"}</div>
      <div className="lib-meta">
        {formatAuthors(p.authors, 4)}
        {normalizeAuthors(p.authors).length > 4 ? " 等" : ""}
        {p.journal ? " · " + p.journal : ""}{p.year ? " · " + p.year : ""}
      </div>
      <div className="lib-badges">
        {p.retracted && <span className="lib-b lib-b-ret">已撤稿</span>}
        {p.preprint && <span className="lib-b lib-b-pre">预印本 · 未经同行评议</span>}
        {!has(p) && p.oa && p.oa !== "closed" && <span className="lib-b lib-b-oa">OA</span>}
        {has(p) && (() => {
          const oa = oaStatusBadge(p.oa, fetchedMeta && fetchedMeta[p.id], "lib-b");
          return oa ? <span className={"lib-b " + oa.cls} title={oa.title || undefined}>{oa.text}</span> : <span className="lib-b">有全文</span>;
        })()}
        {p.hasSummary && <span className="lib-b lib-b-oa">有总结</span>}
        {typeof p.annoCount === "number" && p.annoCount > 0 && <span className="lib-b">批注 {p.annoCount}</span>}
      </div>
      {p.doi && <div className="lib-doi"><Quote size={12} /> {p.doi}</div>}
      {paperGroups(p.id).length > 0 && (
        <div className="lib-grp-badges">
          {paperGroups(p.id).map((L) => (
            <button type="button" key={L.id} className="lib-grp-badge" title="筛选此分组" onClick={() => setActiveList(L.id)}>{L.name}</button>
          ))}
        </div>
      )}
      <div className="lib-acts">
        {!got && onFetch && (
          <button className="lib-act" disabled={isFetching} onClick={() => onFetch(p, { provenance: p.provenance || "find_fetch", channel: "library" })}>
            {isFetching ? <><Loader size={13} className="lib-spin" /> {prog && prog.stageText}</> : <><FileDown size={13} /> 获取全文</>}
          </button>
        )}
        <button className="lib-act" onClick={() => setCiteFor(citeFor === p.id ? null : p.id)}><Copy size={13} /> 复制引用 <ChevronDown size={12} /></button>
        {onRead && got && <button className="lib-act" onClick={() => onRead(p)}><BookOpen size={13} /> 阅读</button>}
        <button className={"lib-act" + (LS.some((L) => L.ids.includes(p.id)) ? " lib-act-on" : "")} onClick={() => setListFor(listFor === p.id ? null : p.id)}><Folder size={13} /> 分组 <ChevronDown size={12} /></button>
        <button className="lib-act lib-act-del" onClick={() => onRemove && onRemove(p.id)} title="从工作集移除，PDF 仍保留"><Trash2 size={13} /> 移除</button>
        {got && onRemove && <button className="lib-act lib-act-del" onClick={() => onRemove(p.id, { deletePdf: true })} title="删除本机 PDF"><Trash2 size={13} /> 删 PDF</button>}
      </div>
      {citeFor === p.id && (
        <div className="lib-cites">
          {STYLES.map((s) => <button key={s[0]} className="lib-cite" onClick={() => copyCite(s[0], p)}>{s[1]}</button>)}
        </div>
      )}
      {listFor === p.id && (
        <div className="lib-lists">
          <div className="lib-lists-h">加入自定义分组（单层 · 一篇可进多组）</div>
          {LS.length === 0 ? <div className="lib-lists-empty">还没有分组。输入名称回车即可新建并加入本篇。</div> : (
            <div className="lib-lists-row">
              {LS.map((L) => (
                <button key={L.id} className={"lib-lchip2" + (L.ids.includes(p.id) ? " on" : "")} onClick={() => onToggleInList && onToggleInList(L.id, p.id)}>
                  {L.ids.includes(p.id) ? <Check size={12} /> : <Folder size={12} />} {L.name}
                </button>
              ))}
            </div>
          )}
          <input className="lib-lists-new" value={newListName} placeholder="新建分组名称，回车加入…"
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitCreateGroup(newListName, p.id); }} />
        </div>
      )}
    </div>
    );
  };

  return (
    <div className="lib">
      <style>{LIB_CSS}</style>
      <div className="lib-head">
        <div className="lib-h1row">
          <h1 className="lib-h1"><BookMarked size={19} /> 我的文献</h1>
          <span className="lib-count">{(lib || []).length} 篇</span>
          <div className="lib-export">
            <button className="lib-xbtn" onClick={() => setExportOpen((v) => !v)} disabled={!view.length}><Download size={14} /> 导出 <ChevronDown size={12} /></button>
            {exportOpen && (
              <div className="lib-xmenu">
                <button onClick={() => doExport("bib")}>.bib（BibTeX）</button>
                <button onClick={() => doExport("ris")}>.ris（EndNote/Zotero）</button>
                <button onClick={() => doExport("csl")}>CSL-JSON</button>
              </div>
            )}
          </div>
        </div>
        <div className="lib-bar">
          <Search size={16} />
          <input value={query} placeholder="搜索标题 / 作者 / 期刊 / 摘要…" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="lib-controls">
          <button className={"lib-chip" + (fFulltext ? " on" : "")} onClick={() => setFFulltext((v) => !v)}>有全文</button>
          <button className={"lib-chip" + (fSummary ? " on" : "")} onClick={() => setFSummary((v) => !v)}>有总结</button>
          <button className={"lib-chip" + (fAnno ? " on" : "")} onClick={() => setFAnno((v) => !v)}>有批注</button>
          <button className={"lib-chip" + (fPreprint ? " on" : "")} onClick={() => setFPreprint((v) => !v)}>预印本</button>
          <button className={"lib-chip" + (fOa ? " on" : "")} onClick={() => setFOa((v) => !v)}>OA</button>
          <button className={"lib-chip" + (grouped ? " on" : "")} onClick={() => setGrouped((v) => !v)}><Layers size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />按来源分组</button>
          <button aria-pressed={selMode} className={"lib-chip" + (selMode ? " on" : "")} onClick={() => { const nx = !selMode; setSelMode(nx); setCorpusEnv(null); if (!nx) setSel(new Set()); }}><Sparkles size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />跨篇分析</button>
          <div className="lib-sort">
            排序
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">最近加入</option>
              <option value="year">年份</option>
              <option value="title">标题</option>
            </select>
          </div>
        </div>
      </div>

      <div className="lib-groupbar">
        <div className="lib-groupbar-h"><Folder size={14} /> 自定义分组<span className="lib-groupbar-hint">单层集合 · 类似文件夹 · 一篇可进多组</span></div>
        <div className="lib-listbar">
          <button type="button" className={"lib-lchip" + (!activeList ? " on" : "")} onClick={() => setActiveList(null)}>全部 <span className="lib-lc-n">{(lib || []).length}</span></button>
          {LS.map((L) => (
            editingGroup === L.id ? (
              <input key={L.id} className="lib-grp-new-inp" value={editGroupName}
                onChange={(e) => setEditGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); skipRenameBlurRef.current = true; submitRenameGroup(L.id); }
                  if (e.key === "Escape") { skipRenameBlurRef.current = true; setEditingGroup(null); }
                }}
                onBlur={() => {
                  if (skipRenameBlurRef.current) { skipRenameBlurRef.current = false; return; }
                  submitRenameGroup(L.id);
                }} />
            ) : (
              <button type="button" key={L.id} className={"lib-lchip" + (activeList === L.id ? " on" : "")} onClick={() => setActiveList(activeList === L.id ? null : L.id)}>
                {L.name} <span className="lib-lc-n">{L.ids.length}</span>
                {activeList === L.id && onRenameList && (
                  <span className="lib-lc-edit" role="button" tabIndex={0} title="重命名" onClick={(e) => { e.stopPropagation(); setEditingGroup(L.id); setEditGroupName(L.name); }}><Pencil size={11} /></span>
                )}
                {activeList === L.id && (
                  <span className="lib-lc-del" role="button" tabIndex={0} title="删除分组" onClick={(e) => { e.stopPropagation(); requestDeleteGroup(L); }}><X size={11} /></span>
                )}
              </button>
            )
          ))}
          {creatingGroup ? (
            <input ref={topNewRef} className="lib-grp-new-inp" value={topNewName} placeholder="分组名称，回车创建…"
              onChange={(e) => setTopNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); skipCreateBlurRef.current = true; submitCreateGroup(topNewName, null); }
                if (e.key === "Escape") { skipCreateBlurRef.current = true; setCreatingGroup(false); setTopNewName(""); }
              }}
              onBlur={() => {
                if (skipCreateBlurRef.current) { skipCreateBlurRef.current = false; return; }
                if (topNewName.trim()) submitCreateGroup(topNewName, null);
                else setCreatingGroup(false);
              }} />
          ) : (
            <button type="button" className="lib-lchip lib-lchip-new" onClick={() => setCreatingGroup(true)}><FolderPlus size={12} /> 新建分组</button>
          )}
        </div>
      </div>

      {selMode && (
        <div className="lib-corpus-bar">
          <div className="lib-corpus-barh"><Sparkles size={14} /> 跨篇分析 · 已选 {sel.size} 篇{sel.size < 2 ? "（至少选 2 篇）" : ""}</div>
          <div className="lib-corpus-tools">
            <button disabled={sel.size < 2 || !!corpusRunning} onClick={() => runCorpus("corpus_framing")}>{corpusRunning === "corpus_framing" ? "分析中…" : "主流框定地图"}</button>
            <button disabled={sel.size < 2 || !!corpusRunning} onClick={() => runCorpus("corpus_contradiction")}>{corpusRunning === "corpus_contradiction" ? "分析中…" : "矛盾发现"}</button>
            <button disabled={sel.size < 2 || !!corpusRunning} onClick={() => runCorpus("corpus_recipe")}>{corpusRunning === "corpus_recipe" ? "分析中…" : "方法配方汇编"}</button>
            {sel.size > 0 && <button className="lib-corpus-clear" onClick={() => setSel(new Set())}>清空</button>}
            {sel.size > 0 && LS.length > 0 && onAddManyToList && (
              <label className="lib-batch-grp">
                批量加入
                <select defaultValue="" onChange={(e) => {
                  const lid = e.target.value;
                  if (!lid) return;
                  onAddManyToList(lid, Array.from(sel));
                  const L = LS.find((x) => x.id === lid);
                  pushToast && pushToast(`已将 ${sel.size} 篇加入「${L ? L.name : "分组"}」`);
                  e.target.value = "";
                }}>
                  <option value="">选择分组…</option>
                  {LS.map((L) => <option key={L.id} value={L.id}>{L.name} ({L.ids.length})</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="lib-corpus-note">仅就你选中的文献做跨篇归纳（限工作集、非全库问答）；基于各篇摘要/缓存总结，结果带出处文献、需回原文核对。建议先给这些文献生成总结，归纳更准。</div>
          {corpusEnv && <CorpusCard env={corpusEnv} />}
        </div>
      )}
      <div className="lib-body">
        {(lib || []).length === 0 ? (
          <div className="lib-empty">
            <BookMarked size={30} strokeWidth={1.6} />
            <h2>还没有收藏的文献</h2>
            <p>在「检索取文」或「阅读·已下载全文」里收藏论文，它们会进入这里。之后可用<strong>自定义分组</strong>按课题整理。</p>
          </div>
        ) : view.length === 0 ? (
          <div className="lib-empty">
            <h2>{activeList ? "此分组暂无文献" : "没有匹配的条目"}</h2>
            <p>{activeList ? "在卡片上点「分组」把文献加入此集合，或切换「全部」查看工作集。" : "调整搜索或筛选试试。"}</p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              {grouped && <div className="lib-group-h">{provName(g.key)} · {g.items.length}</div>}
              {g.items.map((p) => Card(p))}
            </div>
          ))
        )}
      </div>
      <ConfirmDialog
        open={!!deleteGroupConfirm}
        title={deleteGroupConfirm ? `删除分组「${deleteGroupConfirm.name}」？` : ""}
        detail="文献仍保留在工作集，仅移除分组标签。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={doDeleteGroup}
        onCancel={() => setDeleteGroupConfirm(null)}
      />
    </div>
  );
}
