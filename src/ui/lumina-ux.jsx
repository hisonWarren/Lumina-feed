// Lumina Feed · UX 增强组件（patch: lumina_ux）
// 三块：① TitleBar 无边框自定义标题栏（替代 Windows 原生菜单/边框）
//       ② ThemePicker 主题选择器（6 主题，替代昼/夜单切换）
//       ③ SubscriptionManager 订阅 + 推送管理（自定义订阅 / 排程 / 渠道）
import React, { useState, useEffect, useRef } from "react";
import {
  Minus, Square, X, Palette, Check, Plus, Pencil, Trash2, Bell, Clock,
  Mail, Send, Webhook, Rss, ChevronRight, Search, Inbox, Sparkles, Settings,
} from "lucide-react";

/* ════════════════ ① 无边框标题栏 ════════════════ */
export function TitleBar() {
  const [maxed, setMaxed] = useState(false);
  const win = typeof window !== "undefined" ? window.luminaWin : null;
  useEffect(() => {
    if (!win?.onMaximizeChange) return;
    return win.onMaximizeChange((m) => setMaxed(!!m));
  }, []);
  // 无 luminaWin（浏览器预览）时仍渲染拖拽条，但隐藏控制按钮
  return (
    <div className="lux-titlebar">
      <div className="lux-tb-drag">
        <span className="lux-tb-name">Lumina Feed</span>
      </div>
      {win && (
        <div className="lux-tb-ctrls">
          <button className="lux-tb-btn" onClick={() => win.minimize?.()} aria-label="最小化" title="最小化"><Minus size={15} /></button>
          <button className="lux-tb-btn" onClick={() => win.maximize?.()} aria-label="最大化" title={maxed ? "还原" : "最大化"}><Square size={maxed ? 11 : 13} /></button>
          <button className="lux-tb-btn lux-tb-close" onClick={() => win.close?.()} aria-label="关闭" title="关闭"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

/* ════════════════ ② 主题选择器 ════════════════ */
export function ThemePicker({ themes, current, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const cur = themes.find((t) => t.id === current) || themes[0];
  const pick = (id, e) => {
    // 圆形 view-transition 揭示（与原昼夜切换一致）
    if (e) { document.documentElement.style.setProperty("--cx", e.clientX + "px"); document.documentElement.style.setProperty("--cy", e.clientY + "px"); }
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !reduce) document.startViewTransition(() => onPick(id));
    else onPick(id);
    setOpen(false);
  };
  return (
    <div className="lux-theme-wrap" ref={ref}>
      <button className="lf-theme" onClick={() => setOpen((o) => !o)} title="主题" aria-label="选择主题" aria-expanded={open}>
        <Palette size={16} />
      </button>
      {open && (
        <div className="lux-theme-pop" role="menu">
          <div className="lux-pop-h">主题</div>
          {themes.map((t) => (
            <button key={t.id} className={`lux-theme-row${t.id === current ? " on" : ""}`} onClick={(e) => pick(t.id, e)} role="menuitemradio" aria-checked={t.id === current}>
              <span className="lux-sw">{t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <span className="lux-theme-name">{t.name}</span>
              <span className="lux-theme-base">{t.base === "day" ? "亮" : "暗"}</span>
              {t.id === current && <Check size={14} className="lux-theme-ck" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════ ③ 订阅 + 推送管理 ════════════════ */
const SRC_ALL = ["PubMed", "Europe PMC", "OpenAlex", "Crossref", "bioRxiv", "arXiv"];
const FREQ = [["realtime", "实时"], ["daily", "每日"], ["weekly", "每周"]];
const CHANNELS = [["native", "桌面通知", Bell], ["email", "邮件", Mail], ["telegram", "Telegram", Send], ["webhook", "Webhook", Webhook]];

export function emptySub() {
  return { id: "sub-" + Math.random().toString(36).slice(2, 8), name: "", query: "", sources: [...SRC_ALL], freq: "daily", time: "08:00", channels: ["native"], enabled: true };
}

export function SubscriptionManager({ open, subs, onClose, onSave, onDelete }) {
  const [editing, setEditing] = useState(null); // null=列表 ; 对象=编辑
  useEffect(() => { if (!open) setEditing(null); }, [open]);
  if (!open) return null;

  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const save = () => {
    if (!editing.name.trim()) return;
    onSave({ ...editing, name: editing.name.trim() });
    setEditing(null);
  };

  return (
    <div className="lux-modal-scrim" onClick={onClose}>
      <div className="lux-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="订阅与推送">
        <div className="lux-modal-h">
          <div className="lux-modal-title"><Rss size={16} /> 订阅与推送</div>
          <button className="lf-x" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>

        {!editing ? (
          <div className="lux-modal-body">
            <p className="lux-hint">订阅你自己的主题/检索式；命中会按设定的频率与渠道推送。纳入/排除始终由你决定，AI 只排序与总结。</p>
            <button className="lux-new" onClick={() => setEditing(emptySub())}><Plus size={15} /> 新建订阅</button>
            <div className="lux-sub-list">
              {subs.length === 0 && <div className="lux-empty">还没有订阅。点「新建订阅」创建你的第一条文献雷达。</div>}
              {subs.map((s) => (
                <div key={s.id} className="lux-sub-item">
                  <div className="lux-sub-main">
                    <div className="lux-sub-name">{s.name || "（未命名）"}{!s.enabled && <span className="lux-off">已暂停</span>}</div>
                    <div className="lux-sub-meta">
                      <Search size={11} /> {s.query || "（无检索式）"} · <Clock size={11} /> {FREQ.find((f) => f[0] === s.freq)?.[1]}{s.freq !== "realtime" ? ` ${s.time}` : ""} · {s.channels.length} 渠道
                    </div>
                  </div>
                  <div className="lux-sub-actions">
                    <button className="lux-mini" onClick={() => setEditing({ ...s })} title="编辑"><Pencil size={13} /></button>
                    <button className="lux-mini lux-del" onClick={() => onDelete(s.id)} title="删除"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="lux-modal-body">
            <label className="lux-field">
              <span className="lux-lab">名称</span>
              <input className="lux-in" value={editing.name} placeholder="如：心衰 · SGLT2 抑制剂" onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </label>
            <label className="lux-field">
              <span className="lux-lab">检索式 / 主题</span>
              <input className="lux-in" value={editing.query} placeholder='如：(SGLT2 OR empagliflozin) AND heart failure' onChange={(e) => setEditing({ ...editing, query: e.target.value })} />
            </label>
            <div className="lux-field">
              <span className="lux-lab">数据源</span>
              <div className="lux-chips">
                {SRC_ALL.map((s) => (
                  <button key={s} className={`lux-chip${editing.sources.includes(s) ? " on" : ""}`} onClick={() => setEditing({ ...editing, sources: toggle(editing.sources, s) })}>{s}</button>
                ))}
              </div>
            </div>
            <div className="lux-field">
              <span className="lux-lab">推送频率</span>
              <div className="lux-segrow">
                {FREQ.map(([k, l]) => <button key={k} className={`lux-seg${editing.freq === k ? " on" : ""}`} onClick={() => setEditing({ ...editing, freq: k })}>{l}</button>)}
                {editing.freq !== "realtime" && (
                  <input className="lux-time" type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} />
                )}
              </div>
            </div>
            <div className="lux-field">
              <span className="lux-lab">推送渠道</span>
              <div className="lux-chips">
                {CHANNELS.map(([k, l, Ic]) => (
                  <button key={k} className={`lux-chip${editing.channels.includes(k) ? " on" : ""}`} onClick={() => setEditing({ ...editing, channels: toggle(editing.channels, k) })}>
                    <Ic size={12} /> {l}
                  </button>
                ))}
              </div>
            </div>
            <label className="lux-toggle">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              <span>启用此订阅</span>
            </label>
            <div className="lux-modal-foot">
              <button className="lux-btn ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="lux-btn primary" onClick={save} disabled={!editing.name.trim()}><Check size={14} /> 保存订阅</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════ 入口按钮（头部用） ════════════════ */
export function SubscribeEntry({ count, onClick }) {
  return (
    <button className="lux-entry" onClick={onClick} title="管理订阅与每日推送">
      <Rss size={14} /> 订阅 / 推送{count ? <span className="lux-entry-n">{count}</span> : null}
    </button>
  );
}

/* ════════════════ ④ 设置面板（LLM / 邮箱） ════════════════ */
const PROVIDERS = [["deepseek", "DeepSeek"], ["anthropic", "Claude"], ["openai", "OpenAI"], ["moonshot", "Kimi (Moonshot)"], ["ollama", "本地 Ollama"], ["custom", "OpenAI 兼容(自定义)"]];
const MODEL_HINT = { deepseek: "deepseek-chat", anthropic: "claude-3-5-sonnet-latest", openai: "gpt-4o-mini", moonshot: "moonshot-v1-8k", ollama: "llama3.1", custom: "model-name" };
const NEEDS_BASE = { custom: true };

export function SettingsPanel({ open, api, onClose, onSaved }) {
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [base, setBase] = useState("");
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !api) return;
    setLoaded(false);
    api.getSettings().then((s) => {
      if (s && s.llm) { setProvider(s.llm.provider || "deepseek"); setModel(s.llm.model || ""); setBase(s.llm.baseUrl || ""); }
      if (s && s.contactEmail) setEmail(s.contactEmail);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [open, api]);
  if (!open) return null;
  const save = async () => {
    setSaving(true);
    try {
      const llm = { provider, model: model || MODEL_HINT[provider] };
      if (provider === "custom" && base.trim()) llm.baseUrl = base.trim();
      await api.saveSettings({ llm, contactEmail: email });
      if (key.trim()) await api.setSecret(`${provider}_key`, key.trim());
      setKey("");
      onSaved && onSaved();
      onClose();
    } catch { /* surfaced by caller toast */ } finally { setSaving(false); }
  };
  const noBackend = !api;
  return (
    <div className="lux-modal-scrim" onClick={onClose}>
      <div className="lux-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <div className="lux-modal-h">
          <div className="lux-modal-title"><Settings size={16} /> 设置</div>
          <button className="lf-x" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="lux-modal-body">
          {noBackend ? (
            <p className="lux-hint">当前为浏览器预览，未连接桌面引擎。设置（LLM 密钥、检索源等）在 Electron 应用中生效。</p>
          ) : (
            <>
              <p className="lux-hint">配置 AI 总结所用的大模型。密钥存入系统钥匙串（不落明文配置）。本地 Ollama 无需密钥，全程离线。</p>
              <div className="lux-field">
                <span className="lux-lab">LLM 提供方</span>
                <div className="lux-chips">
                  {PROVIDERS.map(([k, l]) => <button key={k} className={`lux-chip${provider === k ? " on" : ""}`} onClick={() => setProvider(k)}>{l}</button>)}
                </div>
              </div>
              <label className="lux-field">
                <span className="lux-lab">模型</span>
                <input className="lux-in" value={model} placeholder={MODEL_HINT[provider]} onChange={(e) => setModel(e.target.value)} />
              </label>
              {NEEDS_BASE[provider] && (
                <label className="lux-field">
                  <span className="lux-lab">接口地址（OpenAI 兼容 base URL）</span>
                  <input className="lux-in" value={base} placeholder="https://api.example.com" onChange={(e) => setBase(e.target.value)} />
                </label>
              )}
              {provider !== "ollama" && (
                <label className="lux-field">
                  <span className="lux-lab">API 密钥（存入钥匙串）</span>
                  <input className="lux-in" type="password" value={key} placeholder={loaded ? "••• 已保存则留空不改 •••" : "加载中…"} onChange={(e) => setKey(e.target.value)} />
                </label>
              )}
              {provider === "deepseek" && <p className="lux-hint" style={{ margin: "-6px 0 12px" }}>DeepSeek 为 OpenAI 兼容接口，默认 api.deepseek.com，填入 DeepSeek 平台的 API Key 即可。</p>}
              <label className="lux-field">
                <span className="lux-lab">联系邮箱（OA 接口礼貌头 / Unpaywall 要求）</span>
                <input className="lux-in" type="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
              </label>
            </>
          )}
          <div className="lux-modal-foot">
            <button className="lux-btn ghost" onClick={onClose}>关闭</button>
            {!noBackend && <button className="lux-btn primary" onClick={save} disabled={saving}><Check size={14} /> {saving ? "保存中…" : "保存设置"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ 作用域样式 ════════════════ */
export const UX_STYLE = `
/* —— 标题栏 —— */
.lux-titlebar{height:34px; display:flex; align-items:stretch; justify-content:space-between; background:var(--bg2); border-bottom:1px solid var(--line); user-select:none; position:relative; z-index:60}
.lux-tb-drag{flex:1; display:flex; align-items:center; padding:0 14px; -webkit-app-region:drag; app-region:drag}
.lux-tb-name{font-family:var(--mono); font-size:10.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink3)}
.lux-tb-ctrls{display:flex; -webkit-app-region:no-drag; app-region:no-drag}
.lux-tb-btn{width:46px; display:grid; place-items:center; background:transparent; border:0; color:var(--ink2); cursor:pointer; transition:background .15s,color .15s}
.lux-tb-btn:hover{background:rgba(127,127,127,.14); color:var(--ink)}
.lux-tb-close:hover{background:#E5484D; color:#fff}

/* —— 主题选择器 —— */
.lux-theme-wrap{position:relative}
.lux-theme-pop{position:absolute; right:0; top:calc(100% + 8px); width:216px; padding:6px; border-radius:13px; background:var(--surf); border:1px solid var(--line2); box-shadow:0 20px 56px rgba(0,0,0,.30), 0 2px 10px rgba(0,0,0,.12); z-index:300; animation:luxPop .16s ease}
@keyframes luxPop{from{opacity:0; transform:translateY(-6px)} to{opacity:1; transform:none}}
.lux-pop-h{font-family:var(--mono); font-size:9.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink3); padding:6px 8px 4px}
.lux-theme-row{width:100%; display:flex; align-items:center; gap:10px; padding:8px; border:0; border-radius:9px; background:transparent; cursor:pointer; color:var(--ink); transition:background .14s}
.lux-theme-row:hover{background:rgba(127,127,127,.1)}
.lux-theme-row.on{background:rgba(127,127,127,.08)}
.lux-sw{display:inline-flex; border-radius:6px; overflow:hidden; box-shadow:0 0 0 1px var(--line2)}
.lux-sw i{width:12px; height:18px; display:block}
.lux-theme-name{flex:1; text-align:left; font-size:13px; font-weight:500}
.lux-theme-base{font-family:var(--mono); font-size:9px; color:var(--ink3); border:1px solid var(--line2); border-radius:4px; padding:1px 5px}
.lux-theme-ck{color:var(--gold)}

/* —— 订阅入口 —— */
.lux-entry{display:inline-flex; align-items:center; gap:7px; height:34px; padding:0 13px; border-radius:9px; border:1px solid var(--line2);
  background:rgba(127,127,127,.05); color:var(--ink2); font-family:var(--sans); font-size:13px; font-weight:500; cursor:pointer; transition:all .18s}
.lux-entry:hover{color:var(--ink); border-color:var(--gold); box-shadow:0 0 14px rgba(127,127,127,.12)}
.lux-entry-n{display:inline-grid; place-items:center; min-width:17px; height:17px; padding:0 5px; border-radius:9px; background:var(--gold); color:var(--bg); font-size:10px; font-weight:700}

/* —— 订阅管理弹窗 —— */
.lux-modal-scrim{position:fixed; inset:0; background:rgba(0,0,0,.42); backdrop-filter:blur(4px); display:grid; place-items:center; z-index:120; animation:luxFade .2s ease}
@keyframes luxFade{from{opacity:0} to{opacity:1}}
.lux-modal{width:min(560px,92vw); max-height:88vh; overflow:auto; border-radius:18px; background:var(--surf); border:1px solid var(--line2); box-shadow:0 30px 80px rgba(0,0,0,.45); animation:luxRise .22s cubic-bezier(.2,.7,.3,1)}
@keyframes luxRise{from{opacity:0; transform:translateY(14px) scale(.98)} to{opacity:1; transform:none}}
.lux-modal-h{display:flex; align-items:center; justify-content:space-between; padding:18px 20px; border-bottom:1px solid var(--line)}
.lux-modal-title{display:flex; align-items:center; gap:10px; font-family:var(--serif); font-weight:600; font-size:18px; color:var(--ink)}
.lux-modal-title svg{color:var(--gold)}
.lux-modal-body{padding:18px 20px 22px}
.lux-hint{font-size:12.5px; line-height:1.55; color:var(--ink2); margin:0 0 16px}
.lux-new{display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:10px; border:1px dashed var(--line2); background:rgba(127,127,127,.04);
  color:var(--gold); font-family:var(--sans); font-size:13px; font-weight:600; cursor:pointer; transition:all .18s; margin-bottom:14px}
.lux-new:hover{border-color:var(--gold); background:rgba(127,127,127,.08)}
.lux-empty{padding:26px 16px; text-align:center; font-size:13px; color:var(--ink3); border:1px dashed var(--line); border-radius:12px}
.lux-sub-list{display:flex; flex-direction:column; gap:10px}
.lux-sub-item{display:flex; align-items:center; gap:12px; padding:13px 15px; border-radius:12px; border:1px solid var(--line); background:rgba(127,127,127,.03)}
.lux-sub-main{flex:1; min-width:0}
.lux-sub-name{font-size:14px; font-weight:600; color:var(--ink); display:flex; align-items:center; gap:8px}
.lux-off{font-size:10px; color:var(--ink3); border:1px solid var(--line2); border-radius:5px; padding:1px 6px}
.lux-sub-meta{font-size:11.5px; color:var(--ink3); margin-top:4px; display:flex; align-items:center; gap:5px; flex-wrap:wrap}
.lux-sub-meta svg{vertical-align:-1px}
.lux-sub-actions{display:flex; gap:6px}
.lux-mini{width:30px; height:30px; display:grid; place-items:center; border-radius:8px; border:1px solid var(--line2); background:transparent; color:var(--ink2); cursor:pointer; transition:all .15s}
.lux-mini:hover{color:var(--ink); border-color:var(--gold)}
.lux-del:hover{color:#E5675B; border-color:#E5675B}
.lux-field{display:block; margin-bottom:15px}
.lux-lab{display:block; font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink3); margin-bottom:7px}
.lux-in{width:100%; padding:10px 13px; border-radius:10px; border:1px solid var(--line2); background:rgba(127,127,127,.05); color:var(--ink); font-family:var(--sans); font-size:13.5px; outline:none; transition:box-shadow .15s,border-color .15s}
.lux-in:focus{border-color:var(--gold); box-shadow:0 0 0 3px rgba(127,127,127,.12)}
.lux-chips{display:flex; flex-wrap:wrap; gap:7px}
.lux-chip{display:inline-flex; align-items:center; gap:5px; padding:6px 11px; border-radius:8px; border:1px solid var(--line2); background:transparent; color:var(--ink2); font-size:12px; cursor:pointer; transition:all .15s}
.lux-chip:hover{color:var(--ink)}
.lux-chip.on{background:rgba(127,127,127,.1); border-color:var(--gold); color:var(--ink)}
.lux-segrow{display:flex; align-items:center; gap:7px}
.lux-seg{padding:7px 14px; border-radius:8px; border:1px solid var(--line2); background:transparent; color:var(--ink2); font-size:12.5px; cursor:pointer; transition:all .15s}
.lux-seg.on{background:var(--gold); color:var(--bg); border-color:var(--gold); font-weight:600}
.lux-time{padding:6px 10px; border-radius:8px; border:1px solid var(--line2); background:rgba(127,127,127,.05); color:var(--ink); font-family:var(--mono); font-size:12px}
.lux-toggle{display:flex; align-items:center; gap:9px; font-size:13px; color:var(--ink2); cursor:pointer; margin:4px 0 4px}
.lux-toggle input{width:16px; height:16px; accent-color:var(--gold)}
.lux-modal-foot{display:flex; justify-content:flex-end; gap:10px; margin-top:18px; padding-top:16px; border-top:1px solid var(--line)}
.lux-btn{display:inline-flex; align-items:center; gap:7px; padding:9px 18px; border-radius:10px; font-family:var(--sans); font-size:13px; font-weight:600; cursor:pointer; transition:all .16s; border:1px solid var(--line2)}
.lux-btn.ghost{background:transparent; color:var(--ink2)}
.lux-btn.ghost:hover{color:var(--ink)}
.lux-btn.primary{background:var(--gold); color:var(--bg); border-color:var(--gold)}
.lux-btn.primary:hover{filter:brightness(1.06)}
.lux-btn.primary:disabled{opacity:.45; cursor:not-allowed}

/* —— issue2：取全文设为卡片主操作 —— */
.lf-act.lf-act-ft{background:var(--gold); color:var(--bg); border-color:var(--gold); font-weight:600}
.lf-act.lf-act-ft:hover:not(:disabled){filter:brightness(1.07)}
.lf-act.lf-act-ft.on{background:transparent; color:var(--t-rct); border-color:var(--line2); font-weight:500}
.lf-act.lf-act-ft:disabled{opacity:.5}
`;
