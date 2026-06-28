// Lumina Feed · AI 总结抽屉 (Grounded Summary Drawer) —— patch: summary_drawer
// 补完检索取文的"照亮(Illuminate)"动作：对某一篇生成接地总结。
// 红线：必显 sourceBasis（基于全文/摘要）与接地比例；AI 只总结不判定纳入排除；
//       撤稿/预印本显著标注；无盗版。live 走 bridge.summarize；无引擎时原型模拟。
import React, { useState, useEffect } from "react";
import { X, Sparkles, ExternalLink, Copy, AlertTriangle, Loader, FileText, KeyRound, BookOpen } from "lucide-react";
import { bridge, hasBackend } from "../lumina-bridge.js";
import FetchBadges from "../FetchBadges.jsx";
import { isFetched, fetchProgressUi, ALT_SUMMARY_CAVEAT } from "../fetch-meta.js";

const DRAWER_CSS = `
.sd-mask{position:fixed;inset:0;z-index:50;background:rgba(10,13,20,.42);display:flex;justify-content:flex-end;animation:sdfade .18s ease}
@keyframes sdfade{from{opacity:0}to{opacity:1}}
.sd{width:min(560px,94vw);height:100%;background:var(--surf);border-left:1px solid var(--line2);display:flex;flex-direction:column;box-shadow:-18px 0 50px rgba(0,0,0,.18);animation:sdslide .22s cubic-bezier(.2,.8,.2,1)}
@keyframes sdslide{from{transform:translateX(30px);opacity:.6}to{transform:none;opacity:1}}
.sd-top{display:flex;align-items:flex-start;gap:10px;padding:18px 20px 14px;border-bottom:1px solid var(--line)}
.sd-top h2{font-family:'Source Serif 4',Georgia,serif;font-size:17px;font-weight:600;line-height:1.4;margin:0;flex:1;color:var(--ink)}
.sd-x{border:none;background:transparent;color:var(--ink3);cursor:pointer;display:grid;place-items:center;padding:2px;border-radius:7px}
.sd-x:hover{background:var(--surf2);color:var(--ink)}
.sd-body{flex:1;min-height:0;overflow-y:auto;padding:18px 20px 30px;display:flex;flex-direction:column;gap:15px}
.sd-meta{font-size:12.5px;color:var(--ink2);line-height:1.6}
.sd-doi{display:inline-flex;align-items:center;gap:5px;font-family:'Space Mono',monospace;font-size:11.5px;color:var(--gold);background:none;border:none;cursor:pointer;padding:0;margin-top:5px}
.sd-doi:hover{text-decoration:underline}
.sd-badges{display:flex;flex-wrap:wrap;gap:6px}
.sd-b{font-size:10.5px;font-family:'Space Mono',monospace;color:var(--ink3);background:var(--surf2);border:1px solid var(--line);border-radius:6px;padding:3px 7px}
.sd-warn{font-size:12.5px;line-height:1.6;color:#b42318;background:rgba(180,35,24,.08);border:1px solid rgba(180,35,24,.25);border-radius:10px;padding:11px 13px;display:flex;gap:8px;align-items:flex-start}
.sd-warn svg{flex-shrink:0;margin-top:1px}
.sd-pre{font-size:12px;color:#9a6b2e;background:rgba(154,107,46,.1);border:1px solid rgba(154,107,46,.25);border-radius:9px;padding:8px 12px}
.sd-opts{display:flex;flex-direction:column;gap:9px;border:1px solid var(--line);border-radius:12px;padding:13px}
.sd-orow{display:flex;align-items:center;gap:10px}
.sd-olbl{font-size:11.5px;color:var(--ink3);width:52px;flex-shrink:0}
.sd-seg{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}
.sd-seg button{border:none;background:transparent;color:var(--ink2);font-size:12px;padding:6px 12px;cursor:pointer;font-family:inherit;border-right:1px solid var(--line2)}
.sd-seg button:last-child{border-right:none}
.sd-seg button.on{background:var(--gold);color:#fff}
.sd-run{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:none;background:var(--gold);color:#fff;border-radius:10px;padding:11px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.sd-run:disabled{opacity:.65;cursor:default}
.sd-basis{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-family:'Space Mono',monospace;color:var(--goldDim);background:rgba(14,124,111,.1);border:1px solid rgba(14,124,111,.25);border-radius:8px;padding:6px 10px;align-self:flex-start}
.sd-basis.abs{color:#9a6b2e;background:rgba(154,107,46,.1);border-color:rgba(154,107,46,.25)}
.sd-sumwrap{border:1px solid var(--line);border-radius:12px;padding:15px;background:var(--surf2)}
.sd-sum{font-size:13.5px;line-height:1.75;color:var(--ink);white-space:pre-wrap}
.sd-sumfoot{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:11px;border-top:1px solid var(--line)}
.sd-mini{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ink2);background:var(--surf);border:1px solid var(--line2);border-radius:8px;padding:6px 11px;cursor:pointer;font-family:inherit}
.sd-mini:hover{border-color:var(--gold);color:var(--gold)}
.sd-model{font-family:'Space Mono',monospace;font-size:10.5px;color:var(--ink4);margin-left:auto}
.sd-guide{font-size:12.5px;line-height:1.65;color:var(--ink2);background:var(--surf2);border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:10px;padding:12px 14px;display:flex;gap:9px;align-items:flex-start}
.sd-guide svg{flex-shrink:0;color:var(--gold);margin-top:1px}
.sd-abs h4{font-size:11px;font-family:'Space Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink4);margin:0 0 6px}
.sd-abs p{font-size:12.5px;line-height:1.7;color:var(--ink2);margin:0}
.sd-foot{display:flex;gap:9px;padding:13px 20px;border-top:1px solid var(--line);flex-wrap:wrap}
.sd-act{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:8px 13px;font-size:12.5px;cursor:pointer;font-family:inherit}
.sd-act:hover{border-color:var(--gold);color:var(--gold)}
.sd-soon{font-size:10px;opacity:.6;margin-left:2px}
.sd-spin{animation:lfspin 1s linear infinite}
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 原型模拟（无引擎时）：明确标注"基于摘要 · 原型模拟"，不杜撰全文细节
function mockSummary(p) {
  const first = (p.abstract || "").slice(0, 180);
  return [
    "（原型模拟 · 基于摘要，未读全文）",
    "• 研究问题：围绕「" + (p.title || "该研究") + "」的核心议题。",
    "• 摘要要点：" + (first || "（摘要不足）"),
    "• 解读：以上仅据摘要生成；接真实引擎后将基于全文产出结构化、可溯源的接地总结。",
  ].join("\n");
}

export default function SummaryDrawer({ paper, fetchedMeta, fetchingMeta, onFetch, onReadPaper, onClose, pushToast }) {
  const [opts, setOpts] = useState({ source: "prefer_fulltext", depth: "structured", lang: "zh" });
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [noKey, setNoKey] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async () => {
    setLoading(true); setErr(null); setNoKey(false); setRes(null);
    try {
      if (hasBackend()) {
        const r = await bridge.summarize(paper.id, { source: opts.source, depth: opts.depth, lang: opts.lang, fetchPdf: "if_oa" });
        if (!r || !r.text) setNoKey(true); else setRes(r);
      } else {
        await sleep(720);
        setRes({ text: mockSummary(paper), sourceBasis: "abstract", groundedRatio: null, banner: null, model: "（原型模拟）" });
      }
    } catch { setErr("总结失败，请稍后重试。"); }
    finally { setLoading(false); }
  };

  const openDoi = () => { const u = "https://doi.org/" + paper.doi; if (hasBackend() && window.luminaApi && window.luminaApi.openExternal) window.luminaApi.openExternal(u); else window.open(u, "_blank"); };
  const copy = () => { try { navigator.clipboard.writeText(res.text); pushToast && pushToast("已复制总结", <Copy size={14} />); } catch { /* noop */ } };

  const got = isFetched(fetchedMeta);
  const isFetching = !!(fetchingMeta && fetchingMeta.startedAt);
  const prog = isFetching ? fetchProgressUi(fetchingMeta, Date.now()) : null;
  const altCaveat = got && fetchedMeta && /libgen|annas|scihub|sci-?hub/.test(String(fetchedMeta.source || fetchedMeta.label || "").toLowerCase());
  const basisFull = res && res.sourceBasis === "fulltext";
  const basisAbs = res && res.sourceBasis === "abstract";
  const Seg = ({ field, items }) => (
    <div className="sd-seg">{items.map(([v, l]) => <button key={v} className={opts[field] === v ? "on" : ""} onClick={() => setOpts((o) => ({ ...o, [field]: v }))}>{l}</button>)}</div>
  );

  return (
    <div className="sd-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{DRAWER_CSS}</style>
      <div className="sd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sd-top">
          <h2>{paper.title}</h2>
          <button className="sd-x" onClick={onClose} title="关闭 (Esc)"><X size={18} /></button>
        </div>

        <div className="sd-body">
          <div>
            <div className="sd-meta">{(paper.authors || []).join(", ")}<br />{paper.journal} · {paper.year}</div>
            <button className="sd-doi" onClick={openDoi}><span>{paper.doi}</span><ExternalLink size={11} /></button>
          </div>

          {paper.retracted && <div className="sd-warn"><AlertTriangle size={15} /> <span>该研究<b>已被撤稿</b>，结论不可引用。如需了解撤稿原因，请查阅期刊撤稿声明。</span></div>}
          {paper.preprint && <div className="sd-pre">预印本 · 未经同行评议 —— 结论尚未经过同行评议，请谨慎采信。</div>}

          <FetchBadges p={paper} fetchedMeta={fetchedMeta} badgePrefix="sd-b" compact />

          <div className="sd-opts">
            <div className="sd-orow"><span className="sd-olbl">来源</span><Seg field="source" items={[["prefer_fulltext", "优先全文"], ["abstract_only", "仅摘要"]]} /></div>
            <div className="sd-orow"><span className="sd-olbl">深度</span><Seg field="depth" items={[["brief", "简要"], ["structured", "结构化"], ["detailed", "详尽"]]} /></div>
            <div className="sd-orow"><span className="sd-olbl">语言</span><Seg field="lang" items={[["zh", "中文"], ["en", "English"]]} /></div>
          </div>

          <button className="sd-run" onClick={run} disabled={loading}>
            {loading ? <><Loader size={15} className="sd-spin" /> 生成中…</> : <><Sparkles size={15} /> 生成接地总结</>}
          </button>

          {err && <div className="sd-warn"><AlertTriangle size={15} /> {err}</div>}

          {noKey && (
            <div className="sd-guide"><KeyRound size={15} /> <span>未能生成总结——通常是<b>尚未在「设置」中配置大模型密钥</b>(密钥仅存于系统钥匙串)。配置后即可对全文/摘要生成可溯源的接地总结。</span></div>
          )}

          {res && (
            <>
              <div className={"sd-basis" + (basisAbs ? " abs" : "")}>
                {basisFull ? "● 基于全文" : basisAbs ? "● 基于摘要（未读全文）" : "● 来源未知"}
                {res.groundedRatio != null && <span>· 接地 {Math.round(res.groundedRatio * 100)}%</span>}
              </div>
              {(altCaveat && basisFull) && <div className="sd-pre">{ALT_SUMMARY_CAVEAT}</div>}
              {res.banner && <div className="sd-pre">{res.banner}</div>}
              <div className="sd-sumwrap">
                <div className="sd-sum">{res.text}</div>
                <div className="sd-sumfoot">
                  <button className="sd-mini" onClick={copy}><Copy size={13} /> 复制</button>
                  {res.model && <span className="sd-model">{res.model}</span>}
                </div>
              </div>
            </>
          )}

          {paper.abstract && (
            <div className="sd-abs"><h4>摘要原文</h4><p>{paper.abstract}</p></div>
          )}
        </div>

        <div className="sd-foot">
          {!got && onFetch && (
            <button className="sd-act" disabled={isFetching} onClick={onFetch}>
              {isFetching ? <><Loader size={13} className="sd-spin" /> {prog && prog.stageText}</> : <><FileText size={13} /> 获取全文</>}
            </button>
          )}
          {got && onReadPaper && <button className="sd-act" onClick={onReadPaper}><BookOpen size={13} /> 阅读全文</button>}
          <button className="sd-act" onClick={openDoi}><ExternalLink size={13} /> 打开 DOI</button>
        </div>
      </div>
    </div>
  );
}
