// Lumina Feed · 阅读模块外壳 + 落地页 (ReadHub)
// 继续阅读：持久化 LRU（元数据）· 打开时再读盘；已下载全文按最近打开排序。
import React, { useState, useRef, useEffect, useCallback } from "react";
import { FolderOpen, Upload, Clock, Download, FileText, BookOpen, Loader, Home, X, ChevronDown, ChevronUp, Trash2, AlertCircle } from "lucide-react";
import { bridge } from "../lumina-bridge.js";
import Reader from "./Reader.jsx";

const HUB_CSS = `
.rh{flex:1;min-height:0;overflow-y:auto;padding:36px 30px 48px;display:flex;flex-direction:column;gap:26px;align-items:center}
.rh-inner{width:100%;max-width:760px;display:flex;flex-direction:column;gap:28px;align-items:stretch;justify-content:center;margin-block:auto;box-sizing:border-box}
.rh-inner,.rh-inner *{box-sizing:border-box}
.rh-main{display:flex;flex-direction:column;gap:24px;width:100%;min-width:0}
.rh-rail{display:flex;flex-direction:column;gap:0;width:100%;min-width:0;background:var(--surf2);border:1px solid var(--line);border-radius:16px;padding:6px 16px 16px;box-shadow:var(--shadow)}
.rh-h{display:flex;flex-direction:column;gap:6px;width:100%}
.rh-eyebrow{font-family:'Space Mono',monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3)}
.rh-h h1{font-family:'Source Serif 4',Georgia,serif;font-size:24px;font-weight:600;margin:0;color:var(--ink)}
.rh-h p{font-size:13.5px;line-height:1.65;color:var(--ink2);margin:0;width:100%}
.rh-drop{width:100%;border:2px dashed var(--line2);border-radius:16px;padding:40px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;background:var(--surf);cursor:pointer;transition:all .16s}
.rh-drop:hover{border-color:var(--gold);background:var(--surf2);box-shadow:var(--shadow)}
.rh-drop.drag{border-color:var(--gold);background:rgba(14,124,111,.06)}
.rh-drop svg{color:var(--gold)}
.rh-drop .t{font-size:15px;font-weight:600;color:var(--ink)}
.rh-drop .s{font-size:12.5px;color:var(--ink3)}
.rh-btn{display:inline-flex;align-items:center;gap:7px;border:none;background:linear-gradient(135deg,var(--gold),var(--goldDim));color:#fff;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:4px;box-shadow:0 2px 8px var(--gold-tint);transition:box-shadow .15s,transform .15s}
.rh-btn:hover{box-shadow:0 5px 16px var(--gold-tint);transform:translateY(-1px)}
.rh-sec{display:flex;flex-direction:column;gap:10px}
.rh-rail .rh-sec{padding:14px 0}
.rh-rail .rh-sec + .rh-sec{border-top:1px solid var(--line)}
.rh-sec-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-family:'Space Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.rh-sec-h-left{display:inline-flex;align-items:center;gap:7px}
.rh-toggle{border:none;background:transparent;color:var(--ink3);cursor:pointer;padding:4px;border-radius:6px;display:inline-flex;align-items:center}
.rh-toggle:hover{color:var(--gold);background:var(--surf)}
.rh-row{display:flex;align-items:center;gap:11px;border:1px solid var(--line);background:var(--surf);border-radius:11px;padding:11px 14px;cursor:pointer}
.rh-row:hover{border-color:var(--gold)}
.rh-row.missing{opacity:.72;cursor:default;border-style:dashed}
.rh-row.missing:hover{border-color:var(--line2)}
.rh-row svg{color:var(--ink3);flex-shrink:0}
.rh-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.rh-row .nm{font-size:13.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rh-row-meta{font-size:11px;color:var(--ink4);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rh-tag{font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid var(--line2);color:var(--ink3);font-family:'Space Mono',monospace}
.rh-tag.gold{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 35%,transparent)}
.rh-row-x{flex-shrink:0;border:none;background:transparent;color:var(--ink4);cursor:pointer;padding:4px;border-radius:6px;display:inline-flex}
.rh-row-x:hover{color:var(--danger);background:var(--surf2)}
.rh-addlib{flex-shrink:0;border:1px solid var(--line2);background:var(--surf2);color:var(--gold);border-radius:7px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit}
.rh-addlib:hover{border-color:var(--gold);background:var(--gold-tint)}
.rh-empty{font-size:12.5px;color:var(--ink4);border:1px dashed var(--line2);border-radius:10px;padding:13px 15px;line-height:1.6}
.rh-spin{animation:rhspin .8s linear infinite;vertical-align:-2px}
@keyframes rhspin{to{transform:rotate(360deg)}}
`;
const RHX_CSS = `
.rhx{height:100%;display:flex;flex-direction:column;min-height:0}
.rhx-tabs{display:flex;align-items:center;gap:4px;padding:7px 12px 0;background:var(--surf);border-bottom:1px solid var(--line);overflow-x:auto;flex-shrink:0}
.rhx-tab{display:inline-flex;align-items:center;gap:6px;max-width:210px;border:1px solid var(--line);border-bottom:none;background:var(--surf2);color:var(--ink2);border-radius:9px 9px 0 0;padding:7px 10px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0}
.rhx-tab:hover{color:var(--ink)}
.rhx-tab.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.rhx-home{padding:7px 9px}
.rhx-tab-nm{overflow:hidden;text-overflow:ellipsis;max-width:150px}
.rhx-tab-x{display:inline-flex;align-items:center;border-radius:4px;padding:1px;opacity:.7}
.rhx-tab-x:hover{opacity:1;background:rgba(255,255,255,.22)}
.rhx-tab:not(.on) .rhx-tab-x:hover{background:var(--line2)}
.rhx-stage{flex:1;min-height:0;position:relative;display:flex}
.rhx-pane{flex:1;min-height:0;flex-direction:column}
`;

function formatRelativeTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return min + " 分钟前";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + " 小时前";
  const day = Math.floor(hr / 24);
  if (day < 7) return day + " 天前";
  try { return new Date(iso).toLocaleDateString(); } catch { return ""; }
}

function ReadHub({
  continueList, loadingContinue, onOpenContinue, onRemoveContinue,
  downloaded, loadingDl, onOpenDownloaded, showAllDl, onToggleAllDl,
  inLibFn, onAddToLibrary, pushToast, onOpenFile,
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onOpenFile(f);
  };

  const continueKeys = new Set((continueList || []).map((x) => x.entryKey));
  const dlExtra = (downloaded || []).filter((it) => it.paperId && !continueKeys.has("paper:" + it.paperId));

  return (
    <div className="rh">
      <style>{HUB_CSS}</style>
      <div className="rh-inner">
        <div className="rh-main">
          <div className="rh-h">
            <span className="rh-eyebrow">阅读 · Reader</span>
            <h1>打开一篇，开始阅读</h1>
            <p>打开本地 PDF 或已下载全文进入全屏阅读台：翻页、缩放、缩略图、查找、文本选择。划词可解释、翻译、高亮、加批注；右侧 AI 助手能做整篇接地总结、带页码引用 p.X 的问答，并按「证据 / 推断」两条车道帮你更深地读这一篇。</p>
          </div>

          <div className={"rh-drop" + (drag ? " drag" : "")}
            onClick={() => inputRef.current && inputRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}>
            <Upload size={30} strokeWidth={1.6} />
            <div className="t">拖拽 PDF 到此，或点击选择</div>
            <div className="s">文件只在本机打开，不上传</div>
            <button className="rh-btn" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current && inputRef.current.click(); }}><FolderOpen size={15} /> 选择 PDF 文件</button>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onOpenFile(f); e.target.value = ""; }} />
          </div>
        </div>

        <div className="rh-rail">
          <div className="rh-sec">
            <div className="rh-sec-h">
              <span className="rh-sec-h-left"><Clock size={13} /> 继续阅读</span>
            </div>
            {loadingContinue ? (
              <div className="rh-empty"><Loader size={14} className="rh-spin" /> 读取继续阅读列表…</div>
            ) : !continueList || continueList.length === 0 ? (
              <div className="rh-empty">还没有阅读记录。打开任意 PDF 后会出现在这里，重启应用仍可一键续读（自动记住页码）。</div>
            ) : (
              continueList.map((it) => (
                <div
                  className={"rh-row" + (it.missing ? " missing" : "")}
                  key={it.entryKey}
                  onClick={() => !it.missing && onOpenContinue(it)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !it.missing) { e.preventDefault(); onOpenContinue(it); } }}
                >
                  {it.missing ? <AlertCircle size={16} /> : <FileText size={16} />}
                  <div className="rh-row-main">
                    <span className="nm">{it.title}</span>
                    <span className="rh-row-meta">
                      <span>{formatRelativeTime(it.openedAt)}</span>
                      {it.page > 1 && <span>· 第 {it.page} 页</span>}
                      <span className={"rh-tag" + (it.kind === "paper" ? " gold" : "")}>{it.kind === "paper" ? "已下载" : "本地文件"}</span>
                      {it.missing && <span className="rh-tag">文件不可用</span>}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rh-row-x"
                    title={it.missing ? "从列表移除" : "不再显示在继续阅读"}
                    onClick={(e) => { e.stopPropagation(); onRemoveContinue(it); }}
                  ><Trash2 size={14} /></button>
                  {!it.missing && <BookOpen size={15} />}
                </div>
              ))
            )}
          </div>

          <div className="rh-sec">
            <div className="rh-sec-h">
              <span className="rh-sec-h-left"><Download size={13} /> 全部已下载全文</span>
              {(downloaded || []).length > 0 && (
                <button type="button" className="rh-toggle" onClick={onToggleAllDl} aria-expanded={showAllDl}>
                  {showAllDl ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}
            </div>
            {loadingDl ? (
              <div className="rh-empty"><Loader size={14} className="rh-spin" /> 读取已下载列表…</div>
            ) : !downloaded || downloaded.length === 0 ? (
              <div className="rh-empty">在「检索取文」获取全文 PDF 后会落盘到此，可一键开读。</div>
            ) : !showAllDl ? (
              <div className="rh-empty">
                共 {downloaded.length} 篇已下载
                {dlExtra.length > 0 ? ` · 另有 ${dlExtra.length} 篇未出现在「继续阅读」` : ""}
                。<button type="button" className="rh-toggle" style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0, fontFamily: "inherit", fontSize: "12.5px", color: "var(--gold)" }} onClick={onToggleAllDl}>展开列表</button>
              </div>
            ) : (
              downloaded.map((it, i) => (
                <div className="rh-row" key={(it.paperId || "") + i} onClick={() => onOpenDownloaded(it)}>
                  <FileText size={16} />
                  <div className="rh-row-main">
                    <span className="nm">{it.title || it.paperId}</span>
                    {it.openedAt && <span className="rh-row-meta"><span>{formatRelativeTime(it.openedAt)}</span></span>}
                  </div>
                  {inLibFn && it.paperId && !inLibFn(it.paperId) && onAddToLibrary && (
                    <button type="button" className="rh-addlib" title="加入我的文献工作集" onClick={(e) => {
                      e.stopPropagation();
                      onAddToLibrary({ id: it.paperId, title: it.title || it.paperId });
                      pushToast && pushToast("已加入工作集 · 可在「我的文献 → 分组」整理");
                    }}>＋工作集</button>
                  )}
                  <BookOpen size={15} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const MAX_TABS = 6;
let _tabSeq = 0;
const tabKey = (t) => t.entryKey || (t.paperId ? "p:" + t.paperId : (t.localPath ? "l:" + t.localPath : "n:" + t.name));

export default function ReaderModule({ pushToast, incoming, onIncomingHandled, readTarget, onReadTargetHandled, inLibFn, onAddToLibrary }) {
  const [st, setSt] = useState({ tabs: [], activeId: null });
  const [continueList, setContinueList] = useState([]);
  const [loadingContinue, setLoadingContinue] = useState(true);
  const [downloaded, setDownloaded] = useState([]);
  const [loadingDl, setLoadingDl] = useState(true);
  const [showAllDl, setShowAllDl] = useState(false);

  const refreshContinue = useCallback(async () => {
    setLoadingContinue(true);
    try {
      const list = await bridge.continueList();
      setContinueList(Array.isArray(list) ? list : []);
    } catch {
      setContinueList([]);
    } finally {
      setLoadingContinue(false);
    }
  }, []);

  const refreshDownloaded = useCallback(async () => {
    setLoadingDl(true);
    try {
      const list = await bridge.listDownloaded();
      setDownloaded(Array.isArray(list) ? list : []);
    } catch {
      setDownloaded([]);
    } finally {
      setLoadingDl(false);
    }
  }, []);

  useEffect(() => {
    void refreshContinue();
    void refreshDownloaded();
  }, [refreshContinue, refreshDownloaded]);

  useEffect(() => {
    if (st.activeId === null) {
      void refreshContinue();
      void refreshDownloaded();
    }
  }, [st.activeId, refreshContinue, refreshDownloaded]);

  const mountTab = useCallback((item) => {
    setSt((s) => {
      const key = tabKey(item);
      const found = s.tabs.find((t) => tabKey(t) === key);
      if (found) return { ...s, activeId: found.id };
      if (s.tabs.length >= MAX_TABS) return s;
      const id = ++_tabSeq;
      return {
        tabs: [...s.tabs, {
          id,
          name: item.name,
          data: item.data,
          paperId: item.paperId,
          localPath: item.localPath,
          entryKey: item.entryKey,
          startPage: item.startPage,
        }],
        activeId: id,
      };
    });
  }, []);

  const openWithPayload = useCallback(async (payload) => {
    const dup = st.tabs.some((t) => tabKey(t) === tabKey(payload));
    if (!dup && st.tabs.length >= MAX_TABS) {
      pushToast && pushToast("最多同时打开 " + MAX_TABS + " 个标签，请先关闭一个");
      return false;
    }
    mountTab(payload);
    return true;
  }, [st.tabs, pushToast, mountTab]);

  const openFromFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") return;
    const localPath = typeof file.path === "string" && file.path ? file.path : null;
    try {
      let data;
      let pathUsed = localPath;
      if (pathUsed) {
        data = await bridge.readLocalPdf(pathUsed);
      }
      if (!data || !data.byteLength) data = await file.arrayBuffer();
      if (!data || !data.byteLength) { pushToast && pushToast("无法读取该 PDF"); return; }
      const name = file.name || "document.pdf";
      let entryKey;
      let startPage = 1;
      if (pathUsed) {
        const rec = await bridge.recordReadingOpen({ localPath: pathUsed, title: name, page: 1 });
        entryKey = rec?.entry?.entryKey;
        startPage = rec?.entry?.page || 1;
      } else {
        pushToast && pushToast("已打开（未记录路径，重启后需重新选择文件）");
      }
      const ok = await openWithPayload({ name, data, localPath: pathUsed, entryKey, startPage });
      if (ok) void refreshContinue();
    } catch {
      pushToast && pushToast("打开 PDF 失败");
    }
  }, [openWithPayload, pushToast, refreshContinue]);

  const openContinue = useCallback(async (entry) => {
    try {
      const res = await bridge.openContinueEntry(entry);
      if (!res.ok) {
        pushToast && pushToast(res.reason === "missing" ? "文件已移动或删除，已从列表标记" : "无法打开");
        void refreshContinue();
        return;
      }
      const ok = await openWithPayload({
        name: res.name || entry.title,
        data: res.data,
        paperId: res.paperId,
        localPath: res.localPath,
        entryKey: res.entryKey || entry.entryKey,
        startPage: res.page || entry.page || 1,
      });
      if (ok) void refreshContinue();
    } catch {
      pushToast && pushToast("打开失败");
    }
  }, [openWithPayload, pushToast, refreshContinue]);

  const openDownloaded = useCallback(async (it) => {
    try {
      const bytes = await bridge.readPdf(it.paperId);
      if (!bytes || !bytes.byteLength) { pushToast && pushToast("无法读取该已下载全文"); return; }
      const title = it.title || it.paperId || "downloaded.pdf";
      const rec = await bridge.recordReadingOpen({ paperId: it.paperId, title, page: 1 });
      const ok = await openWithPayload({
        name: title,
        data: bytes,
        paperId: it.paperId,
        entryKey: rec?.entry?.entryKey || ("paper:" + it.paperId),
        startPage: rec?.entry?.page || 1,
      });
      if (ok) void refreshContinue();
    } catch {
      pushToast && pushToast("读取失败");
    }
  }, [openWithPayload, pushToast, refreshContinue]);

  const removeContinue = useCallback(async (entry) => {
    if (!entry?.entryKey) return;
    await bridge.removeContinueEntry(entry.entryKey);
    void refreshContinue();
    pushToast && pushToast("已从继续阅读移除");
  }, [refreshContinue, pushToast]);

  const closeTab = useCallback((id) => {
    setSt((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const next = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (activeId === id) activeId = next.length === 0 ? null : next[Math.min(Math.max(0, idx - 1), next.length - 1)].id;
      return { tabs: next, activeId };
    });
  }, []);

  useEffect(() => {
    if (!incoming || !incoming.data) return;
    (async () => {
      const name = incoming.name || "document.pdf";
      const localPath = incoming.localPath;
      let entryKey;
      if (localPath) {
        const rec = await bridge.recordReadingOpen({ localPath, title: name, page: 1 });
        entryKey = rec?.entry?.entryKey;
      }
      await openWithPayload({
        name,
        data: incoming.data,
        localPath,
        entryKey,
        startPage: 1,
      });
      void refreshContinue();
      onIncomingHandled && onIncomingHandled();
    })();
  }, [incoming]); // eslint-disable-line

  useEffect(() => {
    if (!readTarget || !readTarget.paperId) return;
    let alive = true;
    (async () => {
      try {
        const bytes = await bridge.readPdf(readTarget.paperId);
        if (!alive) return;
        if (!bytes || !bytes.byteLength) { pushToast && pushToast("无法读取该已下载全文"); return; }
        const title = readTarget.title || readTarget.paperId || "document.pdf";
        const rec = await bridge.recordReadingOpen({ paperId: readTarget.paperId, title, page: 1 });
        await openWithPayload({
          name: title,
          data: bytes,
          paperId: readTarget.paperId,
          entryKey: rec?.entry?.entryKey || ("paper:" + readTarget.paperId),
          startPage: rec?.entry?.page || 1,
        });
        void refreshContinue();
      } catch {
        if (alive) pushToast && pushToast("读取失败");
      } finally {
        if (alive) onReadTargetHandled && onReadTargetHandled();
      }
    })();
    return () => { alive = false; };
  }, [readTarget]); // eslint-disable-line

  const showHub = st.activeId === null;
  return (
    <div className="rhx">
      <style>{RHX_CSS}</style>
      {st.tabs.length > 0 && (
        <div className="rhx-tabs" role="tablist" aria-label="打开的 PDF">
          <button type="button" className={"rhx-tab rhx-home" + (showHub ? " on" : "")} onClick={() => setSt((s) => ({ ...s, activeId: null }))} title="阅读首页" aria-label="阅读首页"><Home size={14} /></button>
          {st.tabs.map((t) => (
            <button type="button" key={t.id} role="tab" aria-selected={t.id === st.activeId} className={"rhx-tab" + (t.id === st.activeId ? " on" : "")} onClick={() => setSt((s) => ({ ...s, activeId: t.id }))} title={t.name}>
              <FileText size={13} /><span className="rhx-tab-nm">{t.name}</span>
              <span className="rhx-tab-x" role="button" title="关闭标签" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><X size={12} /></span>
            </button>
          ))}
        </div>
      )}
      <div className="rhx-stage">
        <div className="rhx-pane" style={{ display: showHub ? "flex" : "none" }}>
          <ReadHub
            continueList={continueList}
            loadingContinue={loadingContinue}
            onOpenContinue={openContinue}
            onRemoveContinue={removeContinue}
            downloaded={downloaded}
            loadingDl={loadingDl}
            onOpenDownloaded={openDownloaded}
            showAllDl={showAllDl}
            onToggleAllDl={() => setShowAllDl((v) => !v)}
            inLibFn={inLibFn}
            onAddToLibrary={onAddToLibrary}
            pushToast={pushToast}
            onOpenFile={openFromFile}
          />
        </div>
        {st.tabs.map((t) => (
          <div key={t.id} className="rhx-pane" style={{ display: t.id === st.activeId ? "flex" : "none" }}>
            <Reader source={t} onClose={() => closeTab(t.id)} pushToast={pushToast} />
          </div>
        ))}
      </div>
    </div>
  );
}
