// Lumina Feed · 检索取文 (Find & Fetch) —— patch: find_fetch
// 定位某一篇 → 取来全文 PDF → 入库(记 provenance)。是"查找一篇"，非"检索语料库"。
// live(有引擎) 时走 bridge.searchOnline / bridge.fetchFullText；无引擎时用内置 mock 预览。
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Search, FileDown, BookOpen, Bookmark, ExternalLink, Check, AlertTriangle, X, Loader, Sparkles, Calendar, ArrowUpDown, ChevronDown, Info } from "lucide-react";
import { bridge, hasBackend, toCardModel } from "../lumina-bridge.js";
import { refreshCardMatchKinds } from "../lib/refresh-match-kind.js";
import { persistSettings } from "../settings-persist.js";
import { isDoi, normDoi, isIdentifierLike, identifierLabel, escapeRe } from "../lib-store.js";
import SummaryDrawer from "./SummaryDrawer.jsx";
import FetchBadges from "../FetchBadges.jsx";
import FetchTrace from "../components/FetchTrace.jsx";
import { isFetched, fetchProgressUi } from "../fetch-meta.js";
import { formatAuthors, normalizeAuthors } from "../lib/format-authors.js";
import AbstractSnippet from "../components/AbstractSnippet.jsx";
import BadgeRow from "../components/BadgeRow.jsx";
import MatchBadge from "../components/MatchBadge.jsx";
import HitSources from "../components/HitSources.jsx";
import SourceChips from "../components/SourceChips.jsx";
import CitationActions from "../components/CitationActions.jsx";
import SearchDepthToggle from "../components/SearchDepthToggle.jsx";
import EmailPrompt from "../components/EmailPrompt.jsx";
import GoogleScholarLink from "../components/GoogleScholarLink.jsx";
import ResultsPager from "../components/ResultsPager.jsx";
import { pageSlice, clampPage } from "../lib/paginate.js";
import { stableMerge, adoptRanking, mergeStreamResults } from "../lib/stable-order.js";
import {
  saveFindFetchSession, loadFindFetchSession, clearFindFetchSession,
  formatSessionAge, sessionSummary,
} from "../find-fetch-session.js";

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

const EXPAND_SOURCES = ["libgen", "annas", "crossref", "openalex", "semanticscholar", "pubmed", "europepmc"];

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
.ff-primary-banner{display:flex;align-items:center;gap:8px;max-width:958px;margin:0 auto 12px;padding:10px 14px;background:color-mix(in srgb,var(--gold) 12%,var(--surf));border:1px solid color-mix(in srgb,var(--gold) 35%,transparent);border-radius:12px;font-size:13px;color:var(--ink2);line-height:1.45}
.ff-primary-banner svg{color:var(--gold);flex-shrink:0}
.ff-card.ff-primary{border-color:color-mix(in srgb,var(--gold) 45%,var(--line));box-shadow:0 0 0 1px color-mix(in srgb,var(--gold) 18%,transparent)}
.ff-enrich{font-size:12px;color:var(--ink3);margin-left:6px}
.ff-track{max-width:958px;margin:0 auto;width:100%}
.ff-session-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;max-width:958px;margin:0 auto 10px;padding:8px 12px;background:var(--surf2);border:1px solid var(--line);border-radius:10px;font-size:12px;color:var(--ink2);line-height:1.45}
.ff-session-bar strong{font-weight:600;color:var(--ink)}
.ff-session-h{flex:1;min-width:140px;font-size:11px;color:var(--ink4)}
.ff-session-new{margin-left:auto;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:8px;padding:4px 10px;font-size:11.5px;cursor:pointer;font-family:inherit}
.ff-session-new:hover{border-color:var(--gold);color:var(--gold)}
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

// 呈现层重排：relevance/cited 信任引擎 BM25；title/author/oldest 客户端二次排序。
function sortResults(list, by) {
  const arr = (list || []).slice();
  if (by === "relevance" || by === "cited") {
    if (by === "cited") arr.sort((a, b) => (b.cites || 0) - (a.cites || 0));
    return arr;
  }
  if (by === "oldest") arr.sort((a, b) => (a.year || 0) - (b.year || 0));
  else if (by === "title") arr.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  else if (by === "author") arr.sort((a, b) => String((a.authors && a.authors[0]) || "").localeCompare(String((b.authors && b.authors[0]) || "")));
  else arr.sort((a, b) => (b.year || 0) - (a.year || 0));
  return arr;
}

function engineSortMode(by) {
  if (by === "newest") return "recent";
  if (by === "cited") return "cited";
  return "relevance";
}

let _searchSeq = 0;
export default function FindFetch({
  fetchedMeta, fetchingMeta, fetchTick, onFetch, onReadPaper, onSave, inLibFn, pushToast, onOpenSettings,
  onSessionChange, active = true,
}) {
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
  const [sortBy, setSortBy] = useState("relevance");
  const [field, setField] = useState("all");
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [perSource, setPerSource] = useState(null);
  const [searchDepth, setSearchDepth] = useState("standard");
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [showSearchEmail, setShowSearchEmail] = useState(false);
  const [fetchEmailPaper, setFetchEmailPaper] = useState(null);
  const [keysCfg, setKeysCfg] = useState({});
  const [pendingSort, setPendingSort] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const latestRanked = useRef([]);
  const curReq = useRef(0);
  const [mergedCount, setMergedCount] = useState(null);
  const [resolvedFrom, setResolvedFrom] = useState(null);
  const [showExpand, setShowExpand] = useState(false);
  const [expandedOnce, setExpandedOnce] = useState(false);
  const [locateMode, setLocateMode] = useState(null);
  const [primaryPaperId, setPrimaryPaperId] = useState(null);
  const [primaryAmbiguous, setPrimaryAmbiguous] = useState(false);
  const [identifierError, setIdentifierError] = useState(null);
  const [retryingSource, setRetryingSource] = useState(null);
  const idAutoRef = useRef("");
  const lastFiltersRef = useRef(null);
  const ref = useRef(null);
  const resultsScrollRef = useRef(null);
  const sessionBootRef = useRef(false);
  const [sessionTs, setSessionTs] = useState(0);

  const applySnapshot = useCallback((snap) => {
    if (!snap) return;
    if (snap.q != null) setQ(snap.q);
    if (snap.submitted) setSubmitted(snap.submitted);
    if (Array.isArray(snap.results)) {
      const refreshed = refreshCardMatchKinds(snap.results, snap.submitted || snap.q, snap.field || "all");
      setResults(refreshed);
      latestRanked.current = refreshed;
    }
    if (snap.sortBy) setSortBy(snap.sortBy);
    if (snap.field) setField(snap.field);
    if (snap.yearFrom != null) setYearFrom(String(snap.yearFrom));
    if (snap.yearTo != null) setYearTo(String(snap.yearTo));
    if (snap.page) setPage(snap.page);
    if (snap.pageSize) setPageSize(snap.pageSize);
    if (snap.perSource) setPerSource(snap.perSource);
    if (snap.mergedCount != null) setMergedCount(snap.mergedCount);
    if (snap.resolvedFrom) setResolvedFrom(snap.resolvedFrom);
    if (snap.locateMode) setLocateMode(snap.locateMode);
    if (snap.primaryPaperId) setPrimaryPaperId(snap.primaryPaperId);
    if (typeof snap.primaryAmbiguous === "boolean") setPrimaryAmbiguous(snap.primaryAmbiguous);
    if (snap.identifierError) setIdentifierError(snap.identifierError);
    if (typeof snap.expandedOnce === "boolean") setExpandedOnce(snap.expandedOnce);
    if (typeof snap.showExpand === "boolean") setShowExpand(snap.showExpand);
    if (Array.isArray(snap.recent)) setRecent(snap.recent);
    if (snap.lastFilters) lastFiltersRef.current = snap.lastFilters;
    if (snap.ts) setSessionTs(snap.ts);
    setLoading(false);
    setErr(null);
    if (snap.scrollTop != null) {
      requestAnimationFrame(() => {
        const el = resultsScrollRef.current;
        if (el) el.scrollTop = snap.scrollTop;
      });
    }
  }, []);

  useEffect(() => {
    if (sessionBootRef.current) return;
    sessionBootRef.current = true;
    const snap = loadFindFetchSession();
    if (snap?.submitted) {
      applySnapshot(snap);
      onSessionChange?.(sessionSummary(snap));
    }
  }, [applySnapshot, onSessionChange]);

  useEffect(() => {
    let alive = true;
    bridge.getSettings().then((s) => {
      if (!alive || !s) return;
      if (s.searchDepth === "full" || s.searchDepth === "standard") setSearchDepth(s.searchDepth);
      setEmailConfigured(!!(s.emailConfigured || s.contactEmail));
    }).catch(() => {});
    bridge.sourcesStatus().then((st) => { if (alive) setKeysCfg(st || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const needsKey = useMemo(() => {
    const m = {};
    if (!keysCfg.core_key) m.core = true;
    if (!keysCfg.lens_token) m.lens = true;
    return m;
  }, [keysCfg]);

  const saveEmail = useCallback(async (email) => {
    const cur = (await bridge.getSettings()) || {};
    await bridge.saveSettings({ ...cur, contactEmail: email });
    setEmailConfigured(true);
    setShowSearchEmail(false);
    setFetchEmailPaper(null);
    pushToast && pushToast("联络邮箱已保存");
  }, [pushToast]);

  const dismissSearchEmail = useCallback(async (action) => {
    setShowSearchEmail(false);
    const cur = (await bridge.getSettings()) || {};
    const prompts = { ...(cur.prompts || {}), searchEmailShown: true };
    await bridge.saveSettings({ ...cur, prompts });
    if (action === "open" && onOpenSettings) onOpenSettings("sources");
  }, [onOpenSettings]);

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

  // P3 · 标识符粘贴后自动检索（debounce）
  useEffect(() => {
    if (!hasBackend()) return;
    const t = q.trim();
    if (!t || !isIdentifierLike(t)) { idAutoRef.current = ""; return; }
    if (t === idAutoRef.current || t === submitted) return;
    const timer = setTimeout(() => {
      if (q.trim() === t && !loading) {
        idAutoRef.current = t;
        run(t);
      }
    }, 480);
    return () => clearTimeout(timer);
  }, [q, submitted, loading]);

  const run = async (val, opts = {}) => {
    const term = (val !== undefined ? val : q).trim();
    if (!term) return;
    if (val !== undefined) setQ(val);
    setSubmitted(term);
    setSessionTs(Date.now());
    setLoading(true); setErr(null); setResults([]); setPerSource(null); setMergedCount(null); setPendingSort(0); latestRanked.current = [];
    setResolvedFrom(null); setShowExpand(false); setLocateMode(null); setIdentifierError(null);
    setPrimaryPaperId(null); setPrimaryAmbiguous(false);
    if (!opts.expand) setExpandedOnce(false);
    setRecent((r) => [term, ...r.filter((x) => x !== term)].slice(0, 6));
    const filters = { field, sort: engineSortMode(sortBy) };
    if (opts.expand) {
      filters.sources = EXPAND_SOURCES;
      setExpandedOnce(true);
    }
    const yf = parseInt(yearFrom, 10), yt = parseInt(yearTo, 10);
    if (!Number.isNaN(yf)) filters.yearFrom = yf;
    if (!Number.isNaN(yt)) filters.yearTo = yt;
    lastFiltersRef.current = filters;
    // 字段范围：把所选字段并入查询（DOI 直达不加；已含 [..] 标签不重复）
    const searchTerm = (field !== "all" && !isIdentifierLike(term) && !term.includes("[")) ? (term + " [" + field + "]") : term;
    const reqId = ++_searchSeq;
    curReq.current = reqId;
    try {
      if (hasBackend() && bridge.searchOnlineStream) {
        // 渐进式：每个开放源返回即增量显示（去重在引擎侧），慢源不拖累首屏
          const streamed = await new Promise((resolve) => {
          let done = false;
          const stop = bridge.searchOnlineStream(searchTerm, filters, reqId, (ev) => {
            if (!ev || ev.reqId !== curReq.current) return;
            if (Array.isArray(ev.papers)) {
              const cards = ev.papers.map((p) => toCardModel(p, searchTerm));
              latestRanked.current = cards;
              setResults((prev) => {
                const { items, appended } = mergeStreamResults(prev, cards, ev.primaryPaperId);
                if (appended) setPendingSort((n) => n + appended);
                setMergedCount(items.length);
                return items;
              });
            }
            if (ev.perSource) setPerSource(ev.perSource);
            if (ev.resolvedFrom) setResolvedFrom(ev.resolvedFrom);
            if (ev.locateMode) setLocateMode(ev.locateMode);
            if (ev.primaryPaperId) setPrimaryPaperId(ev.primaryPaperId);
            if (typeof ev.primaryAmbiguous === "boolean") setPrimaryAmbiguous(ev.primaryAmbiguous);
            if (ev.identifierError) setIdentifierError(ev.identifierError);
            if (ev.resolveError && curReq.current === reqId) setErr(ev.resolveError === "not_found" ? "未找到该标识符的元数据。" : String(ev.resolveError));
            if (ev.done && !done) {
              done = true;
              stop && stop();
              if (!opts.expand && !isIdentifierLike(term) && latestRanked.current.length === 0) setShowExpand(true);
              resolve(true);
            }
          });
          if (!stop) resolve(false); // 旧版预载/无流式支持 → 回落
        });
        if (!streamed && curReq.current === reqId) {
          const r = await bridge.searchOnline(searchTerm, filters);
          const list = (r && r.papers) || [];
          setResults(list);
          setPerSource((r && r.perSource) || null);
          setMergedCount((r && r.count) ?? list.length);
          if (r && r.resolvedFrom) setResolvedFrom(r.resolvedFrom);
          if (r && r.locateMode) setLocateMode(r.locateMode);
          if (r && r.primaryPaperId) setPrimaryPaperId(r.primaryPaperId);
          if (r && typeof r.primaryAmbiguous === "boolean") setPrimaryAmbiguous(r.primaryAmbiguous);
          if (!opts.expand && !isIdentifierLike(term) && !list.length) setShowExpand(true);
        }
        if (curReq.current === reqId && !emailConfigured) {
          const cur = (await bridge.getSettings()) || {};
          if (!cur.prompts?.searchEmailShown) setShowSearchEmail(true);
        }
      } else if (hasBackend()) {
        const r = await bridge.searchOnline(searchTerm, filters);
        const list = (r && r.papers) || [];
        if (curReq.current === reqId) {
          setResults(list);
          setPerSource((r && r.perSource) || null);
          setMergedCount((r && r.count) ?? list.length);
          if (r && r.resolvedFrom) setResolvedFrom(r.resolvedFrom);
          if (r && r.locateMode) setLocateMode(r.locateMode);
          if (r && r.primaryPaperId) setPrimaryPaperId(r.primaryPaperId);
          if (r && typeof r.primaryAmbiguous === "boolean") setPrimaryAmbiguous(r.primaryAmbiguous);
          if (!opts.expand && !isIdentifierLike(term) && !list.length) setShowExpand(true);
        }
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
    } catch (e) {
      if (curReq.current === reqId) { setErr("检索失败，请稍后重试。"); setResults([]); setShowExpand(false); }
    } finally {
      if (curReq.current === reqId) setLoading(false);
    }
  };

  const runExpand = () => run(submitted || q, { expand: true });

  const retrySource = useCallback(async (srcId) => {
    const term = submitted || q;
    if (!term || !hasBackend() || !bridge.searchRetrySource) return;
    setRetryingSource(srcId);
    const filters = lastFiltersRef.current || { field, sort: engineSortMode(sortBy) };
    const searchTerm = (field !== "all" && !isIdentifierLike(term) && !term.includes("[")) ? (term + " [" + field + "]") : term;
    try {
      const r = await bridge.searchRetrySource(srcId, searchTerm, filters);
      if (r && r.perSource) setPerSource((ps) => ({ ...(ps || {}), ...r.perSource }));
      if (r && r.papers && r.papers.length) {
        setResults((prev) => {
          const { items, appended } = stableMerge(prev, r.papers);
          if (appended) setPendingSort((n) => n + appended);
          setMergedCount(items.length);
          return items;
        });
        setShowExpand(false);
      }
    } finally { setRetryingSource(null); }
  }, [submitted, q, field, sortBy]);

  const clear = () => {
    clearFindFetchSession();
    onSessionChange?.(null);
    setSessionTs(0);
    setQ(""); setSubmitted(""); setResults([]); setPerSource(null); setMergedCount(null);
    setLocateMode(null); setPrimaryPaperId(null); setResolvedFrom(null); setErr(null);
    setPage(1); latestRanked.current = [];
    ref.current && ref.current.focus();
  };
  const openDoi = (doi) => { bridge.openExternal("https://doi.org/" + doi); };
  const handleFetch = async (p) => {
    const r = await onFetch(p);
    if (r && r.reason === "missing_email") setFetchEmailPaper(p);
  };
  const idTag = identifierLabel(q);
  const shown = useMemo(() => sortResults(results, sortBy), [results, sortBy]);
  const total = shown.length;
  const safePage = clampPage(page, total, pageSize);
  const pageItems = pageSlice(shown, safePage, pageSize);
  const fieldLabel = (FIELD_OPTS.find((o) => o.id === field) || FIELD_OPTS[0]).label;
  const sessionAge = sessionTs ? formatSessionAge(sessionTs, Date.now() + (fetchTick * 0)) : "";

  useEffect(() => {
    if (!submitted) return;
    const summary = sessionSummary({
      submitted,
      results,
      loading,
      ts: sessionTs || Date.now(),
    });
    onSessionChange?.(summary);
    const t = setTimeout(() => {
      const scrollTop = resultsScrollRef.current?.scrollTop ?? 0;
      const ts = sessionTs || Date.now();
      const snap = {
        q, submitted, sortBy, field, yearFrom, yearTo, page, pageSize,
        perSource, mergedCount, resolvedFrom, locateMode, primaryPaperId, primaryAmbiguous,
        identifierError, expandedOnce, showExpand, recent, lastFilters: lastFiltersRef.current,
        loading, scrollTop, ts,
      };
      if (loading) {
        snap.results = [];
        snap.resultCount = results.length;
      } else {
        snap.results = results;
      }
      saveFindFetchSession(snap);
    }, 350);
    return () => clearTimeout(t);
  }, [
    q, submitted, results, loading, sortBy, field, yearFrom, yearTo, page, pageSize,
    perSource, mergedCount, resolvedFrom, locateMode, primaryPaperId, primaryAmbiguous,
    identifierError, expandedOnce, showExpand, recent, sessionTs, onSessionChange,
  ]);

  useEffect(() => {
    if (!active || !submitted) return;
    const el = resultsScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.focus({ preventScroll: true }); });
  }, [active, submitted]);

  useEffect(() => { setPage(1); }, [submitted, sortBy, field]);

  useEffect(() => {
    const onKey = (e) => {
      if (!submitted) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") setPage((p) => clampPage(p + 1, shown.length, pageSize));
      if (e.key === "ArrowLeft") setPage((p) => clampPage(p - 1, shown.length, pageSize));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitted, shown.length, pageSize]);

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
            placeholder={idTag ? `已识别 ${idTag} — 回车或稍候自动检索` : "粘贴 DOI，或输入标题 / 作者 / 关键词找到那一篇"} />
          {idTag && <span className="ff-idtag">{idTag}</span>}
          {q && <button className="ff-clr" onClick={clear} title="清除"><X size={14} /></button>}
        </div>
        {recent.length > 0 && !submitted && !loading && (
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
          <SearchDepthToggle value={searchDepth} onChange={async (d) => {
            setSearchDepth(d);
            await persistSettings((cur) => ({ ...cur, searchDepth: d }));
          }} />
          {pendingSort > 0 && (
            <button type="button" className="ff-tool on" onClick={() => { setResults(adoptRanking(latestRanked.current)); setPendingSort(0); }}>
              刷新排序 ({pendingSort})
            </button>
          )}
          {submitted && shown.length > 0 && (
            <label className="ff-sort"><ArrowUpDown size={13} /> 排序
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="结果排序">
                <option value="relevance">相关（默认）</option>
                <option value="newest">最新优先</option>
                <option value="cited">被引最多</option>
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

      <div className="ff-results" ref={resultsScrollRef} tabIndex={-1}>
        {submitted && (
          <div className="ff-session-bar" role="status">
            <span><strong>本次检索</strong> · {total} 条{sessionAge ? ` · ${sessionAge}` : ""}{loading ? " · 仍在补充…" : ""}</span>
            <span className="ff-session-h">切换模块不会清空；要开始新的定位请点「新检索」。</span>
            <button type="button" className="ff-session-new" onClick={clear}>新检索</button>
          </div>
        )}
        {submitted && perSource && Object.keys(perSource).length > 0 && (
          <div className="ff-track">
            {locateMode === "primary" && results.length > 0 && (
              <div className="ff-primary-banner">
                <Check size={16} />
                <span>
                  {primaryAmbiguous
                    ? "找到多篇标题高度相似的文献，已置顶最可能的一篇；请核对作者或年份后手动获取全文。"
                    : "已定位到目标文献，请点击「获取全文」下载 PDF；其它来源仍在后台核对。"}
                </span>
              </div>
            )}
            {locateMode === "disambig" && identifierError && (
              <div className="ff-disambig">标识符解析未命中（{identifierError}）· 已回落关键词检索</div>
            )}
            <HitSources perSource={perSource} mergedCount={mergedCount ?? shown.length} needsKey={needsKey}
              onRetrySource={hasBackend() ? retrySource : null} retryingSource={retryingSource} />
            {resolvedFrom && resolvedFrom.length > 0 && (
              <p className="ff-resolved">标识符解析自：{resolvedFrom.join(" · ")}</p>
            )}
          </div>
        )}
        {showSearchEmail && (
          <div className="ff-track">
            <EmailPrompt variant="search" onDismiss={dismissSearchEmail} />
          </div>
        )}
        {!submitted && !loading ? (
          <div className="ff-empty">
            <Search size={28} strokeWidth={1.6} />
            <h2>找到那篇，然后拿来用</h2>
            <p>这不是数据库检索——它帮你<b>定位某一篇</b>并取来全文。粘贴 DOI 直达原文，或用标题、作者、关键词找到它。命中后一键获取 PDF（多源自动尝试）。</p>
            <div className="ff-hint">
              <span className="ff-chip ff-hint-only">粘贴 DOI 回车直达</span>
              <span className="ff-chip ff-hint-only">或输入标题 / 作者 / 关键词</span>
            </div>
          </div>
        ) : loading && results.length === 0 ? (
          <div className="ff-track">
            <div className="lf-skel"><div className="ln" style={{ width: "72%" }} /><div className="ln" style={{ width: "48%" }} /><div className="ln" style={{ width: "88%" }} /></div>
            <div className="lf-skel"><div className="ln" style={{ width: "65%" }} /><div className="ln" style={{ width: "40%" }} /></div>
            <p className="ff-more"><Loader size={14} className="ff-spin" /> 正在检索「{submitted}」…首包通常来自 Crossref / OpenAlex</p>
          </div>
        ) : err ? (
          <div className="ff-empty"><AlertTriangle size={24} /><h2>{err}</h2></div>
        ) : results.length === 0 ? (
          <div className="ff-empty">
            <Search size={24} /><h2>未找到匹配</h2>
            <p>换个关键词，或核对 DOI 是否完整。</p>
            {showExpand && !expandedOnce && !isIdentifierLike(submitted || q) && (
              <div className="ff-expand">
                <p>开放 API 未命中时，可扩大至 <b>LibGen、Anna's Archive</b> 等全文库与少量元数据源重试（可能更慢）。</p>
                <button type="button" className="ff-expand-btn" onClick={runExpand}>扩大至全文库检索</button>
              </div>
            )}
          </div>
        ) : (
          <>
          {pageItems.map((p) => {
            const isPrimary = p.id === primaryPaperId;
            const meta = fetchedMeta[p.id];
            const got = isFetched(meta);
            const fmeta = fetchingMeta[p.id];
            const isFetching = !!fmeta;
            const prog = isFetching ? fetchProgressUi(fmeta, Date.now()) : null;
            const saved = inLibFn(p.id);
            return (
              <div className={"ff-card" + (isPrimary ? " ff-primary" : "")} key={p.id} data-paper-id={p.id}>
                <MatchBadge kind={p.matchKind} primary={isPrimary && locateMode === "primary"} />
                <div className="ff-title" onClick={() => openDoi(p.doi)}>{hi(p.title, p.matched)}</div>
                <div className="ff-meta">{(() => { const a = normalizeAuthors(p.authors); return formatAuthors(a, 4) + (a.length > 4 ? " et al." : ""); })()} · {p.journal || p.abbr}{p.year ? ` · ${p.year}` : ""}</div>
                <button className="ff-doi" onClick={() => openDoi(p.doi)} title="在浏览器打开"><span>{p.doi}</span><ExternalLink size={11} /></button>
                <BadgeRow paper={p} />
                <SourceChips paper={p} sources={p.hitSources} />
                <AbstractSnippet text={p.abstract} />
                <FetchBadges p={p} fetchedMeta={meta} fetchingMeta={fmeta} />
                {fetchEmailPaper && fetchEmailPaper.id === p.id && (
                  <EmailPrompt variant="fetch" onSave={saveEmail} onDismiss={(a) => { if (a === "settings" && onOpenSettings) onOpenSettings("sources"); else setFetchEmailPaper(null); }} />
                )}
                {isFetching && fmeta && fmeta.trace && <FetchTrace steps={fmeta.trace} compact />}
                <div className="ff-actions lf-actions">
                  <button className={"ff-act ff-ft" + (got ? " on" : "") + (isFetching ? " loading" : "")} disabled={isFetching && !got}
                    title={isFetching && fmeta?.queued && !got ? "检索进行中，取文已排队" : undefined}
                    onClick={() => (got ? onReadPaper(p) : handleFetch(p))}>
                    {isFetching && !got ? <><Loader size={13} className="ff-spin" /> {fmeta?.queued && !fmeta?.trace?.length ? "排队中" : (prog?.stageText || "取来中")}{prog && prog.elapsed >= 5 ? <span className="ff-soon"> · {prog.elapsed}s</span> : null}</> : got ? <><BookOpen size={13} /> 阅读</> : <><FileDown size={13} /> 获取全文</>}
                  </button>
                  <button className="ff-act" onClick={() => setSel(p)}><Sparkles size={13} /> AI 总结</button>
                  <button className={"ff-act" + (saved ? " on" : "")} onClick={() => onSave(p)}><Bookmark size={13} fill={saved ? "currentColor" : "none"} /> {saved ? "已收藏" : "收藏"}</button>
                  <CitationActions paper={p} onToast={pushToast} />
                </div>
                {p.oa === "closed" && !got && (
                  <div className="ff-wall">未标注开放获取。仍会尝试 LibGen、Anna's Archive、Sci-Hub 等来源；若均失败，可经<b>机构订阅</b>或向作者索取。</div>
                )}
              </div>
            );
          })}
          <ResultsPager
            total={total}
            page={safePage}
            pageSize={pageSize}
            onPage={(p) => { setPage(p); document.querySelector(".ff-results")?.scrollTo?.({ top: 0, behavior: "smooth" }); }}
            onPageSize={(s) => { setPageSize(s); setPage(1); }}
            onRefine={() => ref.current && ref.current.focus()}
          />
          {loading && results.length > 0 && (
            <div className="ff-more">
              <Loader size={14} className="ff-spin" />
              {locateMode === "primary" ? "已从标题快路径展示结果 · 其它来源仍在补充…" : "还在从其它来源获取…"}
            </div>
          )}
          {submitted && (
            <div className="ff-track">
              <GoogleScholarLink query={submitted} count={shown.length} onOpen={(u) => bridge.openExternal(u)} />
            </div>
          )}
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
