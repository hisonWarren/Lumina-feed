// Lumina Feed · 阅读模块外壳 + 落地页 (ReadHub) —— patch: reader_p1a
// 打开本地 PDF(拖拽/选择) → 进入阅读器工作台。会话内"最近阅读"(内存，重开即用)。
// "已下载全文" 经 bridge.listDownloaded()/readPdf() 读回（reader_engine 暴露 oa:listPdfs/readPdf）。
import React, { useState, useRef, useEffect, useCallback } from "react";
import { FolderOpen, Upload, Clock, Download, FileText, BookOpen, Loader } from "lucide-react";
import { bridge } from "../lumina-bridge.js";
import Reader from "./Reader.jsx";

const HUB_CSS = `
.rh{flex:1;min-height:0;overflow-y:auto;padding:36px 30px 48px;display:flex;flex-direction:column;gap:26px;align-items:center}
.rh-inner{width:100%;max-width:1280px;display:flex;flex-direction:row;flex-wrap:wrap;gap:30px;align-items:flex-start;justify-content:center;margin-block:auto}
.rh-main{flex:1;min-width:320px;max-width:780px;display:flex;flex-direction:column;gap:24px}
.rh-rail{order:-1;flex:0 0 304px;min-width:264px;display:flex;flex-direction:column;gap:0;align-self:flex-start;position:sticky;top:0;background:var(--surf2);border:1px solid var(--line);border-radius:16px;padding:6px 16px 16px;box-shadow:var(--shadow)}
@media (max-width:820px){.rh-inner{flex-direction:column;max-width:760px}.rh-rail{order:0;flex-basis:auto;width:100%;position:static}}
.rh-h{display:flex;flex-direction:column;gap:6px}
.rh-eyebrow{font-family:'Space Mono',monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3)}
.rh-h h1{font-family:'Source Serif 4',Georgia,serif;font-size:24px;font-weight:600;margin:0;color:var(--ink)}
.rh-h p{font-size:13.5px;line-height:1.65;color:var(--ink2);margin:0;max-width:620px}
.rh-drop{border:2px dashed var(--line2);border-radius:16px;padding:40px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;background:var(--surf);cursor:pointer;transition:all .16s}
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
.rh-sec-h{display:flex;align-items:center;gap:7px;font-size:12px;font-family:'Space Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.rh-row{display:flex;align-items:center;gap:11px;border:1px solid var(--line);background:var(--surf);border-radius:11px;padding:11px 14px;cursor:pointer}
.rh-row:hover{border-color:var(--gold)}
.rh-row svg{color:var(--ink3);flex-shrink:0}
.rh-row .nm{flex:1;min-width:0;font-size:13.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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

function ReadHub({ recent, onOpen, downloaded, loadingDl, onOpenDownloaded }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const takeFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") return;
    try { const data = await file.arrayBuffer(); onOpen({ name: file.name, data }); } catch (e) { /* noop */ }
  }, [onOpen]);

  const onDrop = (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; takeFile(f); };

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
          <button className="rh-btn" onClick={(e) => { e.stopPropagation(); inputRef.current && inputRef.current.click(); }}><FolderOpen size={15} /> 选择 PDF 文件</button>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
            onChange={(e) => { takeFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        </div>
        </div>

        <div className="rh-rail">
        <div className="rh-sec">
          <div className="rh-sec-h"><Clock size={13} /> 最近阅读</div>
          {recent.length === 0 ? (
            <div className="rh-empty">本次会话还没打开过 PDF。打开后会出现在这里，重开即用（会话内有效）。</div>
          ) : (
            recent.map((it, i) => (
              <div className="rh-row" key={it.name + i} onClick={() => onOpen(it)}>
                <FileText size={16} /><span className="nm">{it.name}</span><BookOpen size={15} />
              </div>
            ))
          )}
        </div>

        <div className="rh-sec">
          <div className="rh-sec-h"><Download size={13} /> 已下载全文</div>
          {loadingDl ? (
            <div className="rh-empty"><Loader size={14} className="rh-spin" /> 读取已下载列表…</div>
          ) : !downloaded || downloaded.length === 0 ? (
            <div className="rh-empty">在「检索取文」获取全文 PDF 后会出现在这里，一键开读。（需配置可用引擎；本机暂无已下载全文）</div>
          ) : (
            downloaded.map((it, i) => (
              <div className="rh-row" key={(it.paperId || "") + i} onClick={() => onOpenDownloaded(it)}>
                <FileText size={16} /><span className="nm">{it.title || it.paperId}</span><BookOpen size={15} />
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
const tabKey = (t) => (t.paperId ? "p:" + t.paperId : "n:" + t.name);

// 多标签阅读：可同时打开 ≤6 篇，仅活跃标签可见（其余 display:none 保留各自状态）。
// 不做跨标签 AI（每个 Reader 各自单篇接地，红线：阅读器只读单篇）。incoming = 外部（右键/命令行）传入的本地 PDF。
export default function ReaderModule({ pushToast, incoming, onIncomingHandled, readTarget, onReadTargetHandled }) {
  const [st, setSt] = useState({ tabs: [], activeId: null }); // activeId=null → 落地页(hub)
  const [recent, setRecent] = useState([]); // {name,data} 内存，会话内有效
  const [downloaded, setDownloaded] = useState([]);
  const [loadingDl, setLoadingDl] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoadingDl(true);
    bridge.listDownloaded()
      .then((list) => { if (alive) setDownloaded(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setDownloaded([]); })
      .finally(() => { if (alive) setLoadingDl(false); });
    return () => { alive = false; };
  }, [st.activeId]); // 切回落地页时刷新已下载列表

  const open = useCallback((item) => {
    const dup = st.tabs.some((t) => tabKey(t) === tabKey(item));
    if (!dup && st.tabs.length >= MAX_TABS) { pushToast && pushToast("最多同时打开 " + MAX_TABS + " 个标签，请先关闭一个"); return; }
    setRecent((r) => [item, ...r.filter((x) => x.name !== item.name)].slice(0, 6));
    setSt((s) => {
      const found = s.tabs.find((t) => tabKey(t) === tabKey(item));
      if (found) return { ...s, activeId: found.id };
      if (s.tabs.length >= MAX_TABS) return s;
      const id = ++_tabSeq;
      return { tabs: [...s.tabs, { id, name: item.name, data: item.data, paperId: item.paperId }], activeId: id };
    });
  }, [st, pushToast]);

  const openDownloaded = useCallback(async (it) => {
    try {
      const bytes = await bridge.readPdf(it.paperId);
      if (!bytes || !bytes.byteLength) { pushToast && pushToast("无法读取该已下载全文"); return; }
      open({ name: it.title || it.paperId || "downloaded.pdf", data: bytes, paperId: it.paperId }); // 带 paperId → 批注按 paper:<id> 键，关联我的文献
    } catch (e) { pushToast && pushToast("读取失败"); }
  }, [open, pushToast]);

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
    if (incoming && incoming.data) { open({ name: incoming.name || "document.pdf", data: incoming.data }); onIncomingHandled && onIncomingHandled(); }
  }, [incoming]); // eslint-disable-line

  useEffect(() => {
    if (!readTarget || !readTarget.paperId) return;
    let alive = true;
    (async () => {
      try {
        const bytes = await bridge.readPdf(readTarget.paperId);
        if (!alive) return;
        if (!bytes || !bytes.byteLength) { pushToast && pushToast("无法读取该已下载全文"); return; }
        open({ name: readTarget.title || readTarget.paperId || "document.pdf", data: bytes, paperId: readTarget.paperId });
      } catch (e) { if (alive) pushToast && pushToast("读取失败"); }
      finally { if (alive) onReadTargetHandled && onReadTargetHandled(); }
    })();
    return () => { alive = false; };
  }, [readTarget]); // eslint-disable-line

  const showHub = st.activeId === null;
  return (
    <div className="rhx">
      <style>{RHX_CSS}</style>
      {st.tabs.length > 0 && (
        <div className="rhx-tabs" role="tablist" aria-label="打开的 PDF">
          <button className={"rhx-tab rhx-home" + (showHub ? " on" : "")} onClick={() => setSt((s) => ({ ...s, activeId: null }))} title="阅读首页" aria-label="阅读首页"><Home size={14} /></button>
          {st.tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === st.activeId} className={"rhx-tab" + (t.id === st.activeId ? " on" : "")} onClick={() => setSt((s) => ({ ...s, activeId: t.id }))} title={t.name}>
              <FileText size={13} /><span className="rhx-tab-nm">{t.name}</span>
              <span className="rhx-tab-x" role="button" title="关闭标签" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><X size={12} /></span>
            </button>
          ))}
        </div>
      )}
      <div className="rhx-stage">
        <div className="rhx-pane" style={{ display: showHub ? "flex" : "none" }}>
          <ReadHub recent={recent} onOpen={open} downloaded={downloaded} loadingDl={loadingDl} onOpenDownloaded={openDownloaded} />
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
