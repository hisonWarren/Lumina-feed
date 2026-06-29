// Lumina Feed · 模块化壳（find_fetch 前置 · 检索取文接线）
import React, { useState, useCallback, useEffect, useRef } from "react";
import { bridge, hasBackend, countSubsBadge } from "./lumina-bridge.js";
import { DEFAULT_THEME, THEME_CSS, isLight, THEMES } from "./themes.js";
import { LOGO_DATA_URI } from "./brand-logo.js";
import { Telescope, BookOpen, BookMarked, Rss, Settings as SettingsIcon, Palette, Check } from "lucide-react";
import FindFetch from "./modules/FindFetch.jsx";
import ReaderModule from "./modules/ReadHub.jsx";
import Settings from "./modules/Settings.jsx";
import Library from "./modules/Library.jsx";
import Subscriptions from "./modules/Subscriptions.jsx";
import { buildFetchedMeta, isFetched, fetchProgressUi, metaFromAsset, fetchFailHint } from "./fetch-meta.js";
import EmailPrompt from "./components/EmailPrompt.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import AppContextMenu from "./components/AppContextMenu.jsx";
import { runEditAction } from "./context-menu-actions.js";
import { isReaderContextHost } from "./reader-context-host.js";

const BASE_CSS = `
html,body,#root{height:100%;margin:0}
body{background:#F4F4F1;font-family:Inter,system-ui,sans-serif}
.lf{--gold:#0E7C6F;--goldDim:#0B5F55;--gold-tint:color-mix(in srgb,var(--gold) 10%,transparent);--gold-line:color-mix(in srgb,var(--gold) 28%,transparent);--petrol:var(--gold);--petrol-deep:var(--goldDim);--petrol-tint:var(--gold-tint);--petrol-line:var(--gold-line);--ink:#12151C;--ink2:#3A3F4A;--ink3:#6B7280;--ink4:#9CA3AF;--surf:#fff;--surf2:#F8F8F6;--line:#E5E5E0;--line2:#D8D8D2;--raise:#fff;--r:13px;--amber:#BE7A18;--ok:#2C8A60;--danger:#BC3B2B;--shadow:0 1px 2px rgba(20,22,26,.04),0 8px 24px rgba(20,22,26,.06);--shadow-lg:0 24px 60px rgba(20,22,26,.16),0 4px 12px rgba(20,22,26,.08);--sans:Inter,system-ui,sans-serif;height:100vh;width:100%;display:flex;flex-direction:column;color:var(--ink)}
.lf button:focus-visible,.lf input:focus-visible,.lf [role="tab"]:focus-visible,.lf [role="menuitemradio"]:focus-visible{outline:2px solid var(--gold-line);outline-offset:2px}
.lf-top{display:flex;align-items:center;gap:18px;padding:16px 20px 13px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--surf2),var(--surf));flex-shrink:0;position:relative;z-index:40}
.lf.platform-win32 .lf-top{padding-top:20px}
.lf-brand{display:flex;align-items:center;gap:11px;flex-shrink:0}
.lf-logo{width:34px;height:34px;border-radius:10px;flex-shrink:0;display:block;object-fit:cover;box-shadow:0 3px 10px rgba(20,22,26,.20)}
.lf-wm{display:flex;flex-direction:column;line-height:1}
.lf-wm .nm{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:17px;letter-spacing:-.01em;color:var(--ink)}
.lf-wm .tg{font-family:'Space Mono',monospace;font-size:8.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);margin-top:3px}
.lf-stage{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
.lf-pane{flex:1;min-height:0;display:flex;flex-direction:column;width:100%}
.lf-pane.is-hidden{display:none!important}
.lf-tab-label{white-space:nowrap}
.lf-tab-hint{font-size:11px;font-weight:400;opacity:.82;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'Space Mono',monospace}
.lf-tab.on .lf-tab-hint{opacity:.92}
.lf-tab-pulse{width:6px;height:6px;border-radius:50%;background:var(--amber);flex-shrink:0;animation:ff-pulse 1.2s ease-in-out infinite}
.lf-badge-soft{min-width:14px;height:14px;padding:0 4px;font-size:9px;background:color-mix(in srgb,var(--gold) 22%,var(--surf2));color:var(--gold);border:1px solid var(--gold-line)}
.lf-tab.on .lf-badge-soft{background:rgba(255,255,255,.22);color:#fff;border-color:rgba(255,255,255,.35)}
.lf-nav{display:flex;gap:3px;margin:0 auto;background:var(--surf2);padding:4px;border-radius:12px;border:1px solid var(--line)}
.lf-tab{display:inline-flex;align-items:center;gap:7px;border:none;background:transparent;color:var(--ink2);border-radius:9px;padding:7px 14px;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .16s,color .16s,box-shadow .16s}
.lf-tab:hover{color:var(--ink)}
.lf-tab.on{background:var(--gold);color:#fff;box-shadow:0 2px 8px var(--gold-tint)}
.lf-badge{min-width:16px;height:16px;padding:0 5px;border-radius:8px;background:var(--amber);color:#fff;font-size:9.5px;font-weight:700;display:grid;place-items:center;font-family:var(--sans)}
.lf-tab.on .lf-badge{background:rgba(255,255,255,.26)}
.lf-tools{display:flex;align-items:center;gap:8px;flex-shrink:0}
.lf-status{display:inline-flex;align-items:center;gap:7px;font-family:'Space Mono',monospace;font-size:10px;color:var(--ink3);margin-right:2px;white-space:nowrap}
.lf-dot{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok);flex-shrink:0}
.lf-icon{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--surf);color:var(--ink2);display:grid;place-items:center;cursor:pointer;transition:all .15s}
.lf-icon:hover{border-color:var(--line2);color:var(--ink);background:var(--raise)}
.lf-icon.on{border-color:var(--gold-line);color:var(--gold);background:var(--gold-tint)}
.lf-theme-wrap{position:relative}
.lf-tmenu{position:absolute;top:42px;right:0;background:var(--raise);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow-lg);padding:6px;z-index:60;min-width:188px}
.lf-tmenu .th{font-family:'Space Mono',monospace;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3);padding:6px 9px 5px}
.lf-trow{display:flex;align-items:center;gap:10px;width:100%;border:none;background:transparent;border-radius:9px;padding:8px 9px;cursor:pointer;font-family:inherit;font-size:13px;color:var(--ink2);text-align:left}
.lf-trow:hover{background:var(--surf2)}
.lf-trow.on{color:var(--ink)}
.lf-sw{display:inline-flex;gap:2px;flex-shrink:0}
.lf-sw i{width:11px;height:14px;border-radius:3px;display:block}
.lf-trow .ck{margin-left:auto;color:var(--gold);display:inline-flex}
@media (prefers-reduced-motion: reduce){ .lf-tab{transition:none} }
@media (prefers-reduced-motion: reduce){ *,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important} }
.ff{flex:1;min-height:0;display:flex;flex-direction:column}
.ff-head{padding:16px 20px 8px;flex-shrink:0;width:100%;max-width:958px;margin:0 auto}
.ff-bar{display:flex;align-items:center;gap:10px;border:1px solid var(--line2);border-radius:12px;padding:10px 14px;background:var(--surf)}
.ff-bar input{flex:1;border:none;outline:none;font-size:14px;font-family:inherit;background:transparent;color:var(--ink)}
.ff-doitag{font-size:10px;font-family:'Space Mono',monospace;background:rgba(14,124,111,.12);color:var(--gold);padding:2px 6px;border-radius:5px}
.ff-clr{border:none;background:transparent;color:var(--ink3);cursor:pointer;display:grid;place-items:center;padding:2px}
.ff-recent{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
.ff-rl{font-size:11px;color:var(--ink4);font-family:'Space Mono',monospace}
.ff-chip{border:1px solid var(--line2);background:var(--surf2);color:var(--ink2);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.ff-chip:hover{border-color:var(--gold);color:var(--gold)}
.ff-results{flex:1;min-height:0;overflow-y:auto;padding:8px 20px 24px}
.ff-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:48px 24px;text-align:center;color:var(--ink2);min-height:280px}
.ff-empty h2{margin:0;font-size:18px;font-family:'Source Serif 4',Georgia,serif;color:var(--ink)}
.ff-hint{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px}
.ff-hint-only{cursor:default;pointer-events:none;opacity:.88}
.ff-card{border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:0 auto 12px;max-width:920px;background:var(--surf);transition:box-shadow .16s,border-color .16s}
.ff-card:hover{box-shadow:var(--shadow);border-color:var(--line2)}
.ff-title{font-family:'Source Serif 4',Georgia,serif;font-size:16px;font-weight:600;line-height:1.4;cursor:pointer;color:var(--ink)}
.ff-title:hover{color:var(--gold)}
.ff-title mark{background:rgba(14,124,111,.14);color:var(--goldDim);border-radius:3px;padding:0 2px}
.ff-meta{font-size:12.5px;color:var(--ink3);margin-top:6px}
.ff-doi{display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-family:'Space Mono',monospace;font-size:11px;color:var(--gold);background:none;border:none;cursor:pointer;padding:0}
.ff-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.ff-b{font-size:10.5px;font-family:'Space Mono',monospace;color:var(--ink3);background:var(--surf2);border:1px solid var(--line);border-radius:6px;padding:3px 7px}
.ff-b-ret{color:#b42318;background:rgba(180,35,24,.08);border-color:rgba(180,35,24,.25)}
.ff-b-pre{color:#9a6b2e}
.ff-b-oa{color:var(--gold)}
.ff-b-ft,.sd-b-ft,.dg-b-ft,.lib-b-ft{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.ff-b-ready,.sd-b-ready,.dg-b-ready,.lib-b-ready{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 35%,transparent);font-weight:600}
.ff-b-fetching,.sd-b-fetching,.dg-b-fetching,.lib-b-fetching{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 28%,transparent);animation:ff-pulse 1.4s ease-in-out infinite}
@keyframes ff-pulse{0%,100%{opacity:1}50%{opacity:.65}}
.ff-b-alt,.sd-b-alt,.dg-b-alt,.lib-b-alt{color:var(--ink2);border-color:var(--line2)}
.ff-b-nooa,.sd-b-nooa,.dg-b-nooa,.lib-b-nooa{color:var(--ink3)}
.ff-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.ff-act{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
.ff-act:hover{border-color:var(--gold);color:var(--gold)}
.ff-act.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.ff-act.loading{opacity:.7;cursor:default}
.ff-ft.on{background:rgba(14,124,111,.12);color:var(--gold);border-color:rgba(14,124,111,.3)}
.ff-soon{font-size:10px;opacity:.7}
.ff-wall{margin-top:12px;font-size:12px;line-height:1.6;color:var(--ink2);background:var(--surf2);border-left:3px solid var(--gold);padding:10px 12px;border-radius:0 8px 8px 0}
.ff-spin{animation:ffspin .8s linear infinite}
@keyframes ffspin{to{transform:rotate(360deg)}}
.lf-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.15)}
`;

export default function LuminaApp() {
  const [mode, setMode] = useState("find");
  const [prevMode, setPrevMode] = useState("find"); // 设置弹窗打开时，底层仍显示的视图
  const [fetchedMeta, setFetchedMeta] = useState({});
  const [fetchingMeta, setFetchingMeta] = useState({});
  const [fetchTick, setFetchTick] = useState(0);
  const [readTarget, setReadTarget] = useState(null);
  const [lib, setLib] = useState([]);
  const [lists, setLists] = useState([]); // 单层清单 [{id,name,ids}]
  const [toasts, setToasts] = useState([]);
  const [pdfDeleteConfirm, setPdfDeleteConfirm] = useState(null);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [themeOpen, setThemeOpen] = useState(false);
  const [incomingPdf, setIncomingPdf] = useState(null);
  const [subsNew, setSubsNew] = useState(0);
  const [showOnboardingEmail, setShowOnboardingEmail] = useState(false);
  const [findSession, setFindSession] = useState(null);
  const [settingsCat, setSettingsCat] = useState("llm");
  const [ctxMenu, setCtxMenu] = useState(null);
  const ctxEditTarget = useRef(null);
  const ctxPlatform = (typeof window !== "undefined" && window.luminaApi && window.luminaApi.platform) || "win32";

  const refreshSubsBadge = useCallback(async () => {
    try {
      const subs = await bridge.subsList();
      setSubsNew(countSubsBadge(subs));
    } catch { setSubsNew(0); }
  }, []);

  const refreshLib = useCallback(async () => {
    try {
      const rows = await bridge.libraryList();
      if (Array.isArray(rows)) setLib(rows);
    } catch { /* ignore */ }
  }, []);

  const hydrateFetchedMeta = useCallback(async () => {
    if (!hasBackend()) return;
    try {
      await bridge.reconcileOrphans();
      const assets = await bridge.hydratePaperAssets();
      if (!assets || typeof assets !== "object") return;
      setFetchedMeta((prev) => {
        const next = { ...prev };
        for (const [id, asset] of Object.entries(assets)) {
          if (asset && asset.hasPdf && !next[id]) {
            const m = metaFromAsset(asset);
            if (m) next[id] = m;
          }
        }
        return next;
      });
      await refreshLib();
    } catch { /* ignore */ }
  }, [refreshLib]);

  useEffect(() => {
    let alive = true;
    bridge.getSettings().then((s) => {
      if (!alive || !s) return;
      if (s.theme) setTheme(s.theme);
      if (!s.emailConfigured && !s.emailFromEnv && !s.prompts?.onboardingEmailDismissed) {
        setShowOnboardingEmail(true);
      }
    }).catch(() => {});
    bridge.libraryList().then((rows) => { if (alive && Array.isArray(rows)) setLib(rows); }).catch(() => {});
    bridge.listsGet().then((ls) => { if (alive && Array.isArray(ls)) setLists(ls); }).catch(() => {});
    refreshSubsBadge();
    hydrateFetchedMeta();
    const stopSubs = bridge.onSubsUpdated?.(() => { if (alive) refreshSubsBadge(); });
    const stopPapers = bridge.onPapersChanged?.(() => {
      if (!alive) return;
      hydrateFetchedMeta();
    });
    return () => { alive = false; stopSubs?.(); stopPapers?.(); };
  }, [refreshSubsBadge, hydrateFetchedMeta]);

  useEffect(() => {
    if (mode !== "library") return;
    refreshLib();
    bridge.listsGet().then((ls) => { if (Array.isArray(ls)) setLists(ls); }).catch(() => {});
  }, [mode, refreshLib]);

  const onTheme = useCallback(async (id) => {
    setTheme(id);
    try { const s = (await bridge.getSettings()) || {}; await bridge.saveSettings({ ...s, theme: id }); } catch (e) { /* noop */ }
  }, []);
  useEffect(() => {
    if (!themeOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setThemeOpen(false); };
    const onDown = (e) => { if (!(e.target && e.target.closest && e.target.closest(".lf-theme-wrap"))) setThemeOpen(false); };
    window.addEventListener("keydown", onKey); window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [themeOpen]);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.luminaApi : null;
    if (!api || !api.onContextMenu) return;
    return api.onContextMenu((payload) => {
      if (!payload) return;
      if (isReaderContextHost() && !payload.isEditable && !payload.linkURL) return;
      if (payload.isEditable || String(payload.selectionText || "").trim() || payload.linkURL) {
        ctxEditTarget.current = document.activeElement;
        setCtxMenu(payload);
      }
    });
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => { setCtxMenu(null); ctxEditTarget.current = null; };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const onDown = (e) => { if (!(e.target && e.target.closest && e.target.closest(".lf-ctx"))) close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [ctxMenu]);

  const onContextAction = useCallback(async (action, extra) => {
    const api = typeof window !== "undefined" ? window.luminaApi : null;
    const editActions = ["undo", "redo", "cut", "copy", "paste", "selectAll"];
    if (editActions.includes(action)) {
      const done = await runEditAction(action, ctxEditTarget.current);
      if (done) {
        ctxEditTarget.current = null;
        return;
      }
    }
    if (api && api.contextAction) await api.contextAction(action, extra);
    ctxEditTarget.current = null;
  }, []);
  useEffect(() => {
    if (!bridge.onOpenLocalPdf) return;
    bridge.onOpenLocalPdf((payload) => {
      if (payload && payload.data) {
        setIncomingPdf({
          name: payload.name,
          data: payload.data,
          localPath: payload.localPath,
          _t: Date.now(),
        });
        setMode("read");
      }
    });
  }, []);

  useEffect(() => {
    if (!hasBackend() || !bridge.onAppNavigate) return;
    return bridge.onAppNavigate((payload) => {
      if (!payload || !payload.view) return;
      if (payload.view === "settings") {
        if (mode !== "settings") setPrevMode(mode);
        if (payload.settingsCat) setSettingsCat(payload.settingsCat);
        setMode("settings");
        return;
      }
      setMode(payload.view);
      if (payload.view === "read" && payload.continueEntry) {
        setReadTarget({ continueEntry: payload.continueEntry, _t: Date.now() });
      }
    });
  }, [mode]);

  const [primaryAutoOpen, setPrimaryAutoOpen] = useState(true);
  const primaryAutoOpenRef = useRef(true);

  const pushToast = useCallback((msg) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  useEffect(() => {
    if (!hasBackend()) return;
    bridge.getSettings().then((s) => {
      const on = s?.primaryAutoOpenReader !== false;
      setPrimaryAutoOpen(on);
      primaryAutoOpenRef.current = on;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!Object.keys(fetchingMeta).length) return;
    const t = setInterval(() => setFetchTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [fetchingMeta]);

  useEffect(() => {
    if (!hasBackend() || !bridge.onFetchQueue) return;
    const stop = bridge.onFetchQueue((ev) => {
      if (!ev || !ev.paperId) return;
      const id = ev.paperId;
      const steps = ev.trace && (ev.trace.steps || (Array.isArray(ev.trace) ? ev.trace : null));
      if (steps) {
        setFetchingMeta((m) => ({
          ...m,
          [id]: {
            startedAt: m[id]?.startedAt ?? Date.now(),
            trace: steps,
            queued: !!m[id]?.queued,
          },
        }));
      }
      if (ev.status === "running" && !steps) {
        setFetchingMeta((m) => ({
          ...m,
          [id]: {
            startedAt: m[id]?.startedAt ?? Date.now(),
            trace: m[id]?.trace || null,
            queued: !!m[id]?.queued,
          },
        }));
      } else if (ev.status === "done") {
        const r = ev.result;
        if (r && r.ok) {
          const meta = buildFetchedMeta(r);
          if (meta) {
            setFetchedMeta((m) => ({ ...m, [id]: meta }));
            void refreshLib();
            pushToast("已获取全文 · " + meta.label + " · 已保存到本机，可在阅读或我的文献打开");
          }
        } else if (r) {
          const hint = fetchFailHint(r.reason);
          if (hint) pushToast(hint);
          else pushToast("取文未成功（" + (r.reason || "未知原因") + "）。可稍后重试或经机构访问");
        }
        setFetchingMeta((m) => { const n = { ...m }; delete n[id]; return n; });
      } else if (ev.status === "failed") {
        const r = ev.result;
        const hint = fetchFailHint(r && r.reason);
        pushToast(hint || "取文失败，请稍后重试");
        setFetchingMeta((m) => { const n = { ...m }; delete n[id]; return n; });
      }
    });
    return () => stop?.();
  }, [pushToast, refreshLib]);

  const onFetch = useCallback(async (p, opts = {}) => {
    const provenance = opts.provenance || "find_fetch";
    const channel = opts.channel || "manual";
    const searchBusy = !!findSession?.loading;
    const priority = channel === "manual" || channel === "library" || channel === "digest" ? 0 : channel === "batch" ? 1 : 2;
    setFetchingMeta((m) => ({
      ...m,
      [p.id]: { startedAt: Date.now(), trace: null, queued: searchBusy },
    }));
    try {
      if (hasBackend()) {
        await bridge.enqueueFetch([{ paperId: p.id, provenance, channel, priority }]);
        if (searchBusy && priority === 0) {
          pushToast("检索进行中，取文已排队（完成后优先处理）");
        }
        return { queued: true };
      } else {
        try {
          await new Promise((res) => setTimeout(res, 500));
          const mockSource = p.oa !== "closed" ? "unpaywall_mock" : "libgen_mock";
          const meta = buildFetchedMeta({ ok: true, source: mockSource });
          setFetchedMeta((m) => ({ ...m, [p.id]: meta }));
          pushToast("（原型模拟）已取全文 · " + meta.label);
          return { ok: true, source: mockSource };
        } finally {
          setFetchingMeta((m) => { const n = { ...m }; delete n[p.id]; return n; });
        }
      }
    } catch {
      setFetchingMeta((m) => { const n = { ...m }; delete n[p.id]; return n; });
      pushToast("取文请求失败，请稍后重试");
      return { ok: false, reason: "enqueue_failed" };
    }
  }, [pushToast, findSession]);

  const onFetchBatch = useCallback(async (papers, opts = {}) => {
    if (!hasBackend() || !papers.length) {
      papers.forEach((p) => onFetch(p, opts));
      return;
    }
    const provenance = opts.provenance || "subscription";
    const jobs = papers.map((p) => ({
      paperId: p.id,
      provenance,
      channel: opts.channel || "batch",
    }));
    pushToast("已加入取文队列 · " + jobs.length + " 篇（最多 2 篇并行）");
    await bridge.enqueueFetch(jobs);
  }, [pushToast, onFetch]);

  const inLibFn = useCallback((id) => lib.some((x) => x.id === id), [lib]);

  const saveOnboardingEmail = useCallback(async (email) => {
    const cur = (await bridge.getSettings()) || {};
    await bridge.saveSettings({ ...cur, contactEmail: email });
    setShowOnboardingEmail(false);
    pushToast("联络邮箱已保存");
  }, [pushToast]);

  const dismissOnboardingEmail = useCallback(async () => {
    const cur = (await bridge.getSettings()) || {};
    await bridge.saveSettings({ ...cur, prompts: { ...(cur.prompts || {}), onboardingEmailDismissed: true } });
    setShowOnboardingEmail(false);
  }, []);

  const openSettings = useCallback((cat) => {
    if (mode !== "settings") setPrevMode(mode);
    if (cat) setSettingsCat(cat);
    setMode("settings");
  }, [mode]);

  const paperHasFull = useCallback(async (id, p) => {
    if (isFetched(fetchedMeta[id])) return true;
    if (p && p._fetched) return true;
    if (!hasBackend()) return false;
    try {
      const bytes = await bridge.readPdf(id);
      if (bytes && bytes.byteLength) {
        setFetchedMeta((m) => {
          if (m[id]) return m;
          const meta = buildFetchedMeta({ ok: true, source: (p && p.fetchSource) || "cached", cached: true });
          return meta ? { ...m, [id]: meta } : m;
        });
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }, [fetchedMeta]);

  const onReadPaper = useCallback(async (p) => {
    const id = typeof p === "string" ? p : p.id;
    const title = typeof p === "string" ? id : (p.title || id);
    if (!(await paperHasFull(id, typeof p === "object" ? p : null))) {
      pushToast("请先获取全文");
      return;
    }
    if (!hasBackend()) { pushToast("原型模式无法打开已下载 PDF"); return; }
    setReadTarget({ paperId: id, title, _t: Date.now() });
    setMode("read");
  }, [paperHasFull, pushToast]);

  useEffect(() => {
    if (!hasBackend() || !bridge.onPrefetchStart || !bridge.onPrefetchDone) return;
    const offStart = bridge.onPrefetchStart(({ paperId }) => {
      setFetchingMeta((m) => ({
        ...m,
        [paperId]: { startedAt: Date.now(), trace: null, prefetching: true },
      }));
    });
    const offDone = bridge.onPrefetchDone(({ paperId, result, autoOpen }) => {
      setFetchingMeta((m) => { const n = { ...m }; delete n[paperId]; return n; });
      const meta = buildFetchedMeta(result, { prefetched: !result?.cached });
      if (meta) {
        setFetchedMeta((m) => ({ ...m, [paperId]: meta }));
        refreshLib();
        if (autoOpen && primaryAutoOpenRef.current) {
          void onReadPaper({ id: paperId, title: paperId });
        } else {
          pushToast(result?.cached ? "全文已在本地" : "全文已就绪（后台预取）· 已加入我的文献");
        }
      }
    });
    const offFail = bridge.onPrefetchFail?.(({ paperId, result }) => {
      setFetchingMeta((m) => { const n = { ...m }; delete n[paperId]; return n; });
      const why = result?.reason || "no_pdf";
      if (why === "missing_email") return;
      const hint = fetchFailHint(why);
      pushToast(hint || "后台预取未成功，可手动点「获取全文」");
    });
    return () => { offStart && offStart(); offDone && offDone(); offFail && offFail(); };
  }, [pushToast, refreshLib, onReadPaper]);

  const onSave = useCallback((p) => {
    if (lib.some((x) => x.id === p.id)) {
      bridge.libraryRemove(p.id);
      setLib((l) => l.filter((x) => x.id !== p.id));
      const next = lists.map((L) => ({ ...L, ids: L.ids.filter((x) => x !== p.id) }));
      setLists(next); bridge.listsSave(next);
      pushToast("已移出收藏");
    } else {
      bridge.libraryAdd(p, "find_fetch");
      setLib((l) => [...l, { ...p, provenance: "find_fetch" }]);
      pushToast("已收藏 · 可在「我的文献 → 分组」整理");
    }
  }, [lib, lists, pushToast]);

  const onRemoveLib = useCallback(async (id, opts = {}) => {
    if (opts.deletePdf) {
      setPdfDeleteConfirm({ id });
      return;
    }
    await bridge.libraryRemove(id);
    setLib((l) => l.filter((x) => x.id !== id));
    const next = lists.map((L) => ({ ...L, ids: L.ids.filter((x) => x !== id) }));
    setLists(next); bridge.listsSave(next);
    pushToast("已从工作集移除（PDF 仍保留在阅读·已下载）");
  }, [lists, pushToast]);

  const confirmPdfDelete = useCallback(async () => {
    const id = pdfDeleteConfirm?.id;
    if (!id) return;
    setPdfDeleteConfirm(null);
    await bridge.pdfDelete(id, { removeFromLibrary: true });
    setFetchedMeta((m) => { const n = { ...m }; delete n[id]; return n; });
    setLib((l) => l.filter((x) => x.id !== id));
    const next = lists.map((L) => ({ ...L, ids: L.ids.filter((x) => x !== id) }));
    setLists(next); bridge.listsSave(next);
    pushToast("已删除本地 PDF");
  }, [pdfDeleteConfirm, lists, pushToast]);
  const onReadFromLib = useCallback((p) => { if (p) onReadPaper(p); else setMode("read"); }, [onReadPaper]);
  const createList = useCallback((name, firstId) => {
    const id = "L" + Date.now();
    const next = [...lists, { id, name, ids: firstId ? [firstId] : [] }];
    setLists(next); bridge.listsSave(next);
    return id;
  }, [lists]);
  const toggleInList = useCallback((lid, pid) => { const next = lists.map((L) => (L.id === lid ? { ...L, ids: L.ids.includes(pid) ? L.ids.filter((x) => x !== pid) : [...L.ids, pid] } : L)); setLists(next); bridge.listsSave(next); }, [lists]);
  const renameList = useCallback((lid, name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const next = lists.map((L) => (L.id === lid ? { ...L, name: trimmed } : L));
    setLists(next); bridge.listsSave(next);
  }, [lists]);
  const addManyToList = useCallback((lid, ids) => {
    const set = new Set(Array.isArray(ids) ? ids : []);
    if (!set.size) return;
    const next = lists.map((L) => (L.id === lid ? { ...L, ids: [...new Set([...L.ids, ...set])] } : L));
    setLists(next); bridge.listsSave(next);
  }, [lists]);
  const deleteList = useCallback((lid) => { const next = lists.filter((L) => L.id !== lid); setLists(next); bridge.listsSave(next); }, [lists]);

  const view = mode === "settings" ? prevMode : mode; // 设置弹窗时底层视图保持不变

  const findTabHint = findSession?.submitted && view !== "find"
    ? (findSession.submitted.length > 20 ? findSession.submitted.slice(0, 20) + "…" : findSession.submitted)
    : null;

  return (
    <>
      <style>{BASE_CSS + THEME_CSS}</style>
      <div className={"lf" + (isLight(theme) ? " day" : "") + (ctxPlatform === "win32" ? " platform-win32" : "")} data-theme={theme}>
        <header className="lf-top">
          <div className="lf-brand">
            <img className="lf-logo" src={LOGO_DATA_URI} alt="Lumina Feed" width={34} height={34} />
            <div className="lf-wm"><span className="nm">Lumina Feed</span><span className="tg">Locate · Fetch · Illuminate</span></div>
          </div>
          <nav className="lf-nav" role="tablist" aria-label="主模块">
            <button role="tab" aria-selected={view === "find"} className={"lf-tab" + (view === "find" ? " on" : "")} onClick={() => setMode("find")} title={findSession?.submitted ? ("检索会话：" + findSession.submitted) : undefined}>
              <Telescope size={15} />
              <span className="lf-tab-label">检索取文</span>
              {findTabHint && <span className="lf-tab-hint">· {findTabHint}</span>}
              {findSession?.loading && view !== "find" && <span className="lf-tab-pulse" aria-label="检索进行中" />}
              {findSession && findSession.count > 0 && view !== "find" && !findSession.loading && (
                <span className="lf-badge lf-badge-soft">{findSession.count > 99 ? "99+" : findSession.count}</span>
              )}
            </button>
            <button role="tab" aria-selected={view === "subs"} className={"lf-tab" + (view === "subs" ? " on" : "")} onClick={() => setMode("subs")}><Rss size={15} /> 订阅简报 {subsNew > 0 && <span className="lf-badge">{subsNew}</span>}</button>
            <button role="tab" aria-selected={view === "library"} className={"lf-tab" + (view === "library" ? " on" : "")} onClick={() => setMode("library")}><BookMarked size={15} /> 我的文献 {lib.length > 0 && <span className="lf-badge">{lib.length}</span>}</button>
            <button role="tab" aria-selected={view === "read"} className={"lf-tab" + (view === "read" ? " on" : "")} onClick={() => setMode("read")}><BookOpen size={15} /> 阅读</button>
          </nav>
          <div className="lf-tools">
            <span className="lf-status" title="数据、PDF 与索引都在本机"><span className="lf-dot" /> 本机 · 已就绪</span>
            <div className="lf-theme-wrap">
              <button className={"lf-icon" + (themeOpen ? " on" : "")} title="主题" aria-haspopup="true" aria-expanded={themeOpen} onClick={() => setThemeOpen((o) => !o)}><Palette size={16} /></button>
              {themeOpen && (
                <div className="lf-tmenu" role="menu" onMouseLeave={() => setThemeOpen(false)}>
                  <div className="th">主题</div>
                  {THEMES.map((t) => (
                    <button key={t.id} role="menuitemradio" aria-checked={theme === t.id} className={"lf-trow" + (theme === t.id ? " on" : "")} onClick={() => { onTheme(t.id); setThemeOpen(false); }}>
                      <span className="lf-sw">{(t.swatch || []).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                      {t.name}
                      {theme === t.id && <span className="ck"><Check size={14} /></span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className={"lf-icon" + (mode === "settings" ? " on" : "")} title="设置" aria-label="设置" onClick={() => { if (mode !== "settings") setPrevMode(mode); setMode("settings"); }}><SettingsIcon size={16} /></button>
          </div>
        </header>
        <main className="lf-stage">
          <div className={"lf-pane" + (view === "find" ? "" : " is-hidden")} aria-hidden={view !== "find"}>
            <FindFetch
              active={view === "find"}
              onSessionChange={setFindSession}
              fetchedMeta={fetchedMeta}
              fetchingMeta={fetchingMeta}
              fetchTick={fetchTick}
              onFetch={onFetch}
              onReadPaper={onReadPaper}
              onSave={onSave}
              inLibFn={inLibFn}
              pushToast={pushToast}
              onOpenSettings={openSettings}
            />
          </div>
          <div className={"lf-pane" + (view === "subs" ? "" : " is-hidden")} aria-hidden={view !== "subs"}>
              <Subscriptions
                pushToast={pushToast}
                fetchedMeta={fetchedMeta}
                fetchingMeta={fetchingMeta}
                fetchTick={fetchTick}
                onFetch={onFetch}
                onFetchBatch={onFetchBatch}
                onReadPaper={onReadPaper}
                onSubsChange={refreshSubsBadge}
                inLibFn={inLibFn}
                onOpenSettings={openSettings}
                tabActive={view === "subs"}
              />
          </div>
          <div className={"lf-pane" + (view === "read" ? "" : " is-hidden")} aria-hidden={view !== "read"}>
              <ReaderModule
                pushToast={pushToast}
                incoming={incomingPdf}
                onIncomingHandled={() => setIncomingPdf(null)}
                readTarget={readTarget}
                onReadTargetHandled={() => setReadTarget(null)}
                inLibFn={inLibFn}
                onAddToLibrary={(p) => onSave(p)}
              />
          </div>
          <div className={"lf-pane" + (view === "library" ? "" : " is-hidden")} aria-hidden={view !== "library"}>
              <Library lib={lib} lists={lists} onCreateList={createList} onToggleInList={toggleInList} onDeleteList={deleteList} onRenameList={renameList} onAddManyToList={addManyToList} onRemove={onRemoveLib} onRead={onReadFromLib} onFetch={onFetch} fetchedMeta={fetchedMeta} fetchingMeta={fetchingMeta} fetchTick={fetchTick} pushToast={pushToast} />
          </div>
        </main>
        {mode === "settings" && (
          <Settings theme={theme} onTheme={onTheme} pushToast={pushToast} onClose={() => setMode(prevMode)} initialCat={settingsCat} />
        )}
        {showOnboardingEmail && (
          <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "rgba(18,21,28,.35)" }}>
            <EmailPrompt variant="onboarding" onSave={saveOnboardingEmail} onDismiss={dismissOnboardingEmail} />
          </div>
        )}
        {toasts.map((t) => (
          <div key={t.id} className="lf-toast">{t.msg}</div>
        ))}
        <ConfirmDialog
          open={!!pdfDeleteConfirm}
          title="删除本地 PDF？"
          detail="将同时删除本机 PDF 文件与全文索引；工作集条目也会移除。此操作不可恢复。"
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          onConfirm={confirmPdfDelete}
          onCancel={() => setPdfDeleteConfirm(null)}
        />
        {ctxMenu && (
          <AppContextMenu
            payload={ctxMenu}
            platform={ctxPlatform}
            onAction={onContextAction}
            onClose={() => setCtxMenu(null)}
          />
        )}
      </div>
    </>
  );
}
