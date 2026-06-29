// Lumina Feed · 设置 —— 弹窗 + 左侧分类（大模型 / 阅读 / 外观 / 隐私 / 通用 / 关于）
// 复用引擎既有 settings:get/save + secrets:set（密钥仅入系统钥匙串，绝不写配置/代码 = 红线3）。
// 主题切换由壳层 onTheme 即时应用 + 持久化；视觉读图归「隐私」；阅读偏好归「阅读」。豆包模型框支持 Model ID 或推理接入点 ep-。
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Cpu, Palette, Bell, Mail, KeyRound, Check, Save, Info, Eye, EyeOff, Plug, ChevronDown, RefreshCw, Loader, X, BookOpen, Shield, Trash2, Database } from "lucide-react";
import { bridge, hasBackend } from "../lumina-bridge.js";
import { persistSettings } from "../settings-persist.js";
import { THEMES } from "../themes.js";
import { CURATED_MODELS, PROVIDER_DEFAULT_MODEL, OLLAMA_MODEL_PRESETS } from "../../core/summarize/model-presets.ts";
import SourceKeysPanel from "../components/SourceKeysPanel.jsx";
import MirrorSettingsPanel from "../components/MirrorSettingsPanel.jsx";
import SourceTogglesPanel, { PrefetchToggleRow, OaPrefetchToggleRow, PrimaryAutoOpenToggleRow } from "../components/SourceTogglesPanel.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

// provider 预设：id 即引擎 LlmConfig.provider；密钥名 = `${id}_key`；ollama 无需 key；自定义需 baseUrl。
const PROVIDERS = [
  { id: "deepseek",  label: "DeepSeek（默认）", model: PROVIDER_DEFAULT_MODEL.deepseek, needsKey: true,  base: "https://api.deepseek.com" },
  { id: "anthropic", label: "Claude（Anthropic）", model: PROVIDER_DEFAULT_MODEL.anthropic, needsKey: true,  base: "https://api.anthropic.com" },
  { id: "openai",    label: "OpenAI",            model: PROVIDER_DEFAULT_MODEL.openai, needsKey: true,  base: "https://api.openai.com" },
  { id: "moonshot",  label: "Kimi（Moonshot）",  model: PROVIDER_DEFAULT_MODEL.moonshot, needsKey: true,  base: "https://api.moonshot.cn" },
  { id: "doubao",    label: "豆包（火山方舟）",    model: PROVIDER_DEFAULT_MODEL.doubao, needsKey: true,  base: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "ollama",    label: "Ollama（本地）",     model: PROVIDER_DEFAULT_MODEL.ollama, needsKey: false, base: "http://localhost:11434", showBase: true },
  { id: "custom",    label: "自定义（OpenAI 兼容）", model: "",                          needsKey: true,  base: "", showBase: true, baseRequired: true },
];
// 内置兜底清单（动态 listModels 失败或未配 key 时使用；云端下拉经引擎精选过滤）
const MODEL_PRESETS = {
  deepseek: [...CURATED_MODELS.deepseek],
  anthropic: [...CURATED_MODELS.anthropic],
  openai: [...CURATED_MODELS.openai],
  moonshot: [...CURATED_MODELS.moonshot],
  doubao: [...CURATED_MODELS.doubao],
  ollama: [...OLLAMA_MODEL_PRESETS],
  custom: [],
};
const presetOf = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

// 设置分类（左侧导航）：随类目增长，左栏才名副其实——本版把视觉读图独立为「隐私」，并新增「阅读」「关于」。
const CATS = [
  { id: "llm", label: "大模型", icon: Cpu },
  { id: "sources", label: "数据源", icon: Database },
  { id: "reader", label: "阅读", icon: BookOpen },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "privacy", label: "隐私", icon: Shield },
  { id: "general", label: "通用", icon: Bell },
  { id: "about", label: "关于", icon: Info },
];

const SET_CSS = `
.set-h1{font-family:'Source Serif 4',Georgia,serif;font-size:22px;font-weight:600;margin:0;color:var(--ink)}
.set-sec-d{font-size:12px;color:var(--ink3);line-height:1.55;margin:-6px 0 0}
.set-row{display:flex;flex-direction:column;gap:6px}
.set-lbl{font-size:12px;color:var(--ink2);font-weight:500}
.set-provs{display:flex;flex-wrap:wrap;gap:7px}
.set-prov{border:1px solid var(--line2);background:var(--surf);color:var(--ink2);border-radius:9px;padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
.set-prov:hover{border-color:var(--gold);color:var(--gold)}
.set-prov.on{background:var(--gold);color:#fff;border-color:var(--gold)}
.set-in{border:1px solid var(--line2);border-radius:9px;padding:9px 11px;font-size:13px;font-family:inherit;background:var(--surf);color:var(--ink);outline:none;width:100%;box-sizing:border-box}
.set-in:focus{border-color:var(--gold)}
.set-mono{font-family:'Space Mono',monospace;font-size:12px}
.set-hint{font-size:11px;color:var(--ink4);line-height:1.5}
.set-ep-ok{color:var(--goldDim);font-weight:500}
.set-btnrow{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.set-btn2{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);background:var(--surf);color:var(--ink);border-radius:10px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.set-btn2:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.set-btn2:disabled{opacity:.6;cursor:default}
.set-test{font-size:12px;font-family:'Space Mono',monospace;border-radius:8px;padding:7px 10px;line-height:1.5}
.set-test.ok{color:var(--goldDim);background:rgba(14,124,111,.08);border:1px solid rgba(14,124,111,.25)}
.set-test.err{color:#9a6b2e;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3)}
.set-key{display:flex;gap:8px;align-items:center}
.set-key svg{color:var(--ink3);flex-shrink:0}
.set-lbl-sub{font-weight:400;color:var(--ink4);font-size:11px}
.set-combo{position:relative;display:flex;gap:8px;align-items:center}
.set-combo-btn{flex:1;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--line2);border-radius:9px;padding:9px 11px;background:var(--surf);color:var(--ink);cursor:pointer;font-family:inherit;min-width:0}
.set-combo-btn:hover{border-color:var(--gold)}
.set-combo-in{flex:1;border:1px solid var(--line2);border-radius:9px;padding:9px 11px;background:var(--surf);color:var(--ink);font-family:inherit;min-width:0}
.set-combo-in:focus{border-color:var(--gold);outline:none}
.set-combo-tg{flex-shrink:0;width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;background:var(--surf);color:var(--ink2);cursor:pointer}
.set-combo-tg:hover{border-color:var(--gold);color:var(--gold)}
.set-key-eye{flex-shrink:0;width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;background:var(--surf);color:var(--ink2);cursor:pointer}
.set-key-eye:hover{border-color:var(--gold);color:var(--gold)}
.set-key-st{font-size:12px;margin-top:6px;display:flex;align-items:center;gap:6px}
.set-key-st.ok{color:var(--ok,#2d8a4e)}
.set-combo-rf{flex-shrink:0;width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;background:var(--surf);color:var(--ink2);cursor:pointer}
.set-combo-rf:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.set-combo-rf:disabled{opacity:.6;cursor:default}
.set-spin{display:inline-flex;animation:set-spin 1s linear infinite}
@keyframes set-spin{to{transform:rotate(360deg)}}
.set-combo-menu{position:absolute;top:calc(100% + 5px);left:0;right:0;z-index:30;background:var(--raise);border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow-lg);padding:5px;max-height:264px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.set-combo-note{font-size:10.5px;color:var(--ink4);padding:5px 9px 3px}
.set-combo-opt{display:flex;align-items:center;justify-content:space-between;gap:8px;border:none;background:transparent;color:var(--ink2);text-align:left;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:12.5px}
.set-combo-opt:hover{background:var(--surf2);color:var(--gold)}
.set-combo-opt.on{color:var(--gold)}
.set-btn{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;border:none;background:var(--gold);color:#fff;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.set-btn:disabled{opacity:.6;cursor:default}
.set-themes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.set-theme{border:1.5px solid var(--line2);border-radius:11px;padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:8px;background:var(--surf)}
.set-theme:hover{border-color:var(--gold)}
.set-theme.on{border-color:var(--gold);box-shadow:0 0 0 2px rgba(14,124,111,.18)}
.set-sw{height:34px;border-radius:7px;display:flex;overflow:hidden;border:1px solid var(--line2)}
.set-sw span{flex:1}
.set-theme-nm{font-size:12px;color:var(--ink2);display:flex;align-items:center;justify-content:space-between}
.set-theme-nm .ck{color:var(--gold)}
.set-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px}
.set-switch{width:42px;height:24px;border-radius:13px;border:none;cursor:pointer;position:relative;transition:background .15s;background:var(--line2)}
.set-switch.on{background:var(--gold)}
.set-switch i{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
.set-switch.on i{left:20px}
.set-note{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.55;color:var(--ink3);background:var(--surf2);border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.set-note svg{color:var(--gold);flex-shrink:0;margin-top:1px}
.set-note-t{flex:1;min-width:0}
.set-note-t .set-mono{word-break:break-all}
.set-warn{color:#9a6b2e;background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.3)}
@media (prefers-reduced-motion: reduce){ .set-switch,.set-switch i,.set-prov,.set-theme,.set-btn{transition:none !important} }
/* 弹窗外壳 + 左侧分类导航 */
.set-backdrop{position:fixed;inset:0;z-index:200;background:rgba(20,18,16,.46);display:flex;align-items:center;justify-content:center;padding:28px;backdrop-filter:blur(2px)}
.set-modal{width:100%;max-width:880px;height:100%;max-height:680px;background:var(--surf);border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden}
.set-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line);flex-shrink:0}
.set-close{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;background:var(--surf);color:var(--ink2);cursor:pointer}
.set-close:hover{border-color:var(--gold);color:var(--gold)}
.set-modal-body{flex:1;min-height:0;display:flex}
.set-rail{width:176px;flex-shrink:0;border-right:1px solid var(--line);padding:12px 10px;display:flex;flex-direction:column;gap:3px;overflow-y:auto;background:var(--surf2)}
.set-railbtn{display:flex;align-items:center;gap:10px;border:none;background:transparent;color:var(--ink2);text-align:left;padding:9px 12px;border-radius:10px;cursor:pointer;font-size:13.5px;font-family:inherit;font-weight:500}
.set-railbtn svg{color:var(--ink3);flex-shrink:0}
.set-railbtn:hover{background:var(--surf);color:var(--ink)}
.set-railbtn.on{background:var(--gold);color:#fff}
.set-railbtn.on svg{color:#fff}
.set-pane{flex:1;min-width:0;overflow-y:auto;padding:24px 28px 40px;display:flex;flex-direction:column;gap:20px}
.set-pane-h{font-family:'Source Serif 4',Georgia,serif;font-size:18px;font-weight:600;margin:0 0 2px;color:var(--ink);display:flex;align-items:center;gap:9px}
.set-pane-h svg{color:var(--gold)}
.set-kv{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:2px 0}
.set-kv-main{display:flex;flex-direction:column;gap:3px;min-width:0}
.set-kv-d{font-size:11px;color:var(--ink4);line-height:1.5}
.set-seg{display:inline-flex;gap:3px;background:var(--surf2);border:1px solid var(--line);border-radius:9px;padding:3px}
.set-seg button{border:none;background:transparent;color:var(--ink2);padding:6px 12px;border-radius:7px;cursor:pointer;font-size:12.5px;font-family:inherit}
.set-seg button.on{background:var(--gold);color:#fff}
.set-kbd{font-family:'Space Mono',monospace;font-size:11px;background:var(--surf2);border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--ink2)}
.set-kbd-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12.5px;color:var(--ink2);padding:5px 0;border-bottom:1px dashed var(--line)}
.set-kbd-row:last-child{border-bottom:none}
.set-about{font-size:12.5px;color:var(--ink2);line-height:1.7}
.set-about b{color:var(--ink)}
.set-btn-danger{background:transparent;border:1px solid color-mix(in srgb,var(--danger,#BC3B2B) 45%,transparent);color:var(--danger,#BC3B2B)}
.set-btn-danger:hover{background:color-mix(in srgb,var(--danger,#BC3B2B) 8%,transparent)}
@media (max-width:680px){ .set-rail{width:128px} .set-modal{max-height:none;height:100%} }
`;

export default function Settings({ theme, onTheme, pushToast, onClose, initialCat = "llm" }) {
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState(PROVIDER_DEFAULT_MODEL.deepseek);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [notifications, setNotifications] = useState(true);
  const [digestNotifyTier, setDigestNotifyTier] = useState("regular");
  const [digestReportAuto, setDigestReportAuto] = useState(true);
  const [bgTray, setBgTray] = useState(false);
  const [bgLogin, setBgLogin] = useState(false);
  const [autoIngest, setAutoIngest] = useState(true);
  const [savingLlm, setSavingLlm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [visionConsent, setVisionConsent] = useState(false);
  const [savingGen, setSavingGen] = useState(false);
  const [activeCat, setActiveCat] = useState(initialCat);
  const [rememberPos, setRememberPos] = useState(true);     // 续读位置（默认开）
  const [defaultZoom, setDefaultZoom] = useState(1.1);       // 阅读器默认缩放
  const [nightInvert, setNightInvert] = useState(false);     // 夜读反色默认
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [userDataPath, setUserDataPath] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [searchDepth, setSearchDepth] = useState("standard");
  const [altMirrors, setAltMirrors] = useState({});
  const [prefetchOnIdentifier, setPrefetchOnIdentifier] = useState(true);
  const [prefetchOaResults, setPrefetchOaResults] = useState(true);
  const [primaryAutoOpenReader, setPrimaryAutoOpenReader] = useState(true);
  const [keysConfigured, setKeysConfigured] = useState({});
  const [llmKeySaved, setLlmKeySaved] = useState(false);
  const backend = hasBackend();

  const refreshKeysStatus = useCallback(async () => {
    const st = await bridge.sourcesStatus();
    setKeysConfigured(st || {});
  }, []);

  const refreshLlmKeyStatus = useCallback(async (prov) => {
    const p = prov || provider;
    const pr = presetOf(p);
    if (!backend || !pr.needsKey) { setLlmKeySaved(false); return; }
    const has = await bridge.secretHas(p + "_key");
    setLlmKeySaved(!!has);
  }, [provider, backend]);

  /** 后台/自启：切换即持久化并同步主进程。 */
  const persistAppBackground = useCallback(async (nextTray, nextLogin) => {
    if (!backend) return false;
    try {
      if (bridge.setBackground) {
        const r = await bridge.setBackground(nextTray, nextLogin);
        if (nextTray && (!r || r.ok === false)) {
          pushToast && pushToast((r && r.message) || "系统托盘不可用，无法开启后台运行");
          return false;
        }
      }
      const r = await persistSettings((cur) => ({
        ...cur,
        app: { ...(cur.app || {}), minimizeToTray: nextTray, openAtLogin: nextLogin },
      }));
      if (!r.ok) { pushToast && pushToast("后台/自启设置保存失败"); return false; }
      return true;
    } catch {
      pushToast && pushToast("后台/自启设置保存失败");
      return false;
    }
  }, [backend, pushToast]);

  const onToggleBgTray = useCallback(async () => {
    const next = !bgTray;
    setBgTray(next);
    const ok = await persistAppBackground(next, bgLogin);
    if (!ok && next) setBgTray(false);
  }, [bgTray, bgLogin, persistAppBackground]);

  const onToggleBgLogin = useCallback(async () => {
    const next = !bgLogin;
    setBgLogin(next);
    await persistAppBackground(bgTray, next);
  }, [bgTray, bgLogin, persistAppBackground]);

  const persistGeneralToggle = useCallback(async (patch, rollback) => {
    if (!backend) return;
    const r = await persistSettings((cur) => ({ ...cur, ...patch }));
    if (!r.ok) {
      pushToast && pushToast("设置保存失败");
      rollback && rollback();
    }
  }, [backend, pushToast]);

  const onToggleAutoIngest = useCallback(async () => {
    const next = !autoIngest;
    setAutoIngest(next);
    await persistGeneralToggle({ autoIngestOnFetch: next }, () => setAutoIngest(!next));
  }, [autoIngest, persistGeneralToggle]);

  const onToggleNotifications = useCallback(async () => {
    const next = !notifications;
    setNotifications(next);
    await persistGeneralToggle({ notifications: next }, () => setNotifications(!next));
  }, [notifications, persistGeneralToggle]);

  const onPickDigestTier = useCallback(async (tier) => {
    const prev = digestNotifyTier;
    setDigestNotifyTier(tier);
    await persistGeneralToggle({ digestNotifyTier: tier }, () => setDigestNotifyTier(prev));
  }, [digestNotifyTier, persistGeneralToggle]);

  const onToggleDigestReportAuto = useCallback(async () => {
    const next = !digestReportAuto;
    setDigestReportAuto(next);
    await persistGeneralToggle({ digestReportAuto: next }, () => setDigestReportAuto(!next));
  }, [digestReportAuto, persistGeneralToggle]);

  const persistReaderPrefs = useCallback(async (patch, rollback) => {
    if (!backend) return;
    const r = await persistSettings((cur) => ({
      ...cur,
      reader: { ...(cur.reader || {}), ...patch },
    }));
    if (!r.ok) {
      pushToast && pushToast("阅读设置保存失败");
      rollback && rollback();
    }
  }, [backend, pushToast]);

  const onToggleRememberPos = useCallback(async () => {
    const next = !rememberPos;
    setRememberPos(next);
    await persistReaderPrefs({ rememberPos: next }, () => setRememberPos(!next));
  }, [rememberPos, persistReaderPrefs]);

  const onToggleNightInvert = useCallback(async () => {
    const next = !nightInvert;
    setNightInvert(next);
    await persistReaderPrefs({ nightInvert: next }, () => setNightInvert(!next));
  }, [nightInvert, persistReaderPrefs]);

  const onPickDefaultZoom = useCallback(async (val) => {
    const prev = defaultZoom;
    setDefaultZoom(val);
    await persistReaderPrefs({ defaultZoom: val }, () => setDefaultZoom(prev));
  }, [defaultZoom, persistReaderPrefs]);

  const onClearContinueReading = useCallback(async () => {
    if (!backend) return;
    const r = await bridge.clearContinueReading();
    if (r && r.ok) pushToast && pushToast("已清除继续阅读记录");
    else pushToast && pushToast("清除失败");
  }, [backend, pushToast]);

  const onToggleVisionConsent = useCallback(async () => {
    const next = !visionConsent;
    const pr = presetOf(provider);
    setVisionConsent(next);
    if (!backend) return;
    const r = await persistSettings((cur) => ({
      ...cur,
      llm: {
        ...(cur.llm || {}),
        provider,
        model: (model || pr.model).trim(),
        visionConsent: next,
        ...(pr.showBase && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      },
    }));
    if (!r.ok) {
      pushToast && pushToast("隐私设置保存失败");
      setVisionConsent(!next);
    }
  }, [visionConsent, provider, model, baseUrl, backend, pushToast]);

  const buildLlmPayload = useCallback((overrides = {}) => {
    const pr = presetOf(overrides.provider ?? provider);
    const llm = {
      provider: overrides.provider ?? provider,
      model: String(overrides.model ?? model ?? pr.model).trim(),
      visionConsent: overrides.visionConsent ?? visionConsent,
    };
    const bu = overrides.baseUrl !== undefined ? overrides.baseUrl : baseUrl;
    if (pr.showBase && String(bu || "").trim()) llm.baseUrl = String(bu).trim();
    return llm;
  }, [provider, model, baseUrl, visionConsent]);

  const persistLlmFields = useCallback(async (overrides = {}, rollback) => {
    if (!backend) return false;
    const r = await persistSettings((cur) => ({
      ...cur,
      llm: { ...(cur.llm || {}), ...buildLlmPayload(overrides) },
    }));
    if (!r.ok) {
      pushToast && pushToast("大模型设置保存失败");
      rollback && rollback();
      return false;
    }
    return true;
  }, [backend, buildLlmPayload, pushToast]);

  const llmBlurTimer = useRef(null);
  const scheduleLlmBlurSave = useCallback((overrides = {}) => {
    if (!backend) return;
    if (llmBlurTimer.current) clearTimeout(llmBlurTimer.current);
    llmBlurTimer.current = setTimeout(() => { void persistLlmFields(overrides); }, 600);
  }, [backend, persistLlmFields]);
  useEffect(() => () => { if (llmBlurTimer.current) clearTimeout(llmBlurTimer.current); }, []);

  useEffect(() => {
    let alive = true;
    bridge.getSettings().then((s) => {
      if (!alive || !s) return;
      if (s.llm && s.llm.provider) { setProvider(s.llm.provider); setModel(s.llm.model || presetOf(s.llm.provider).model); if (s.llm.baseUrl) setBaseUrl(s.llm.baseUrl); if (typeof s.llm.visionConsent === "boolean") setVisionConsent(s.llm.visionConsent); }
      if (typeof s.contactEmail === "string") setContactEmail(s.contactEmail);
      if (s.searchDepth === "full" || s.searchDepth === "standard") setSearchDepth(s.searchDepth);
      if (s.altMirrors && typeof s.altMirrors === "object") setAltMirrors(s.altMirrors);
      if (typeof s.prefetchOnIdentifier === "boolean") setPrefetchOnIdentifier(s.prefetchOnIdentifier);
      else setPrefetchOnIdentifier(true);
      if (typeof s.prefetchOaResults === "boolean") setPrefetchOaResults(s.prefetchOaResults);
      else setPrefetchOaResults(true);
      if (typeof s.primaryAutoOpenReader === "boolean") setPrimaryAutoOpenReader(s.primaryAutoOpenReader);
      else setPrimaryAutoOpenReader(true);
      if (typeof s.notifications === "boolean") setNotifications(s.notifications);
      if (s.digestNotifyTier === "calm" || s.digestNotifyTier === "regular" || s.digestNotifyTier === "power") setDigestNotifyTier(s.digestNotifyTier);
      if (typeof s.digestReportAuto === "boolean") setDigestReportAuto(s.digestReportAuto);
      else setDigestReportAuto(true);
      if (s.app) {
        setBgTray(!!s.app.minimizeToTray);
        setBgLogin(!!s.app.openAtLogin);
        if (s.app.minimizeToTray && bridge.setBackground) {
          bridge.setBackground(true, !!s.app.openAtLogin).then((r) => {
            if (r && r.ok === false) setBgTray(false);
          }).catch(() => {});
        } else if (bridge.setBackground) {
          bridge.setBackground(!!s.app.minimizeToTray, !!s.app.openAtLogin);
        }
      } else if (bridge.setBackground) {
        bridge.setBackground(false, false);
      }
      if (typeof s.autoIngestOnFetch === "boolean") setAutoIngest(s.autoIngestOnFetch);
      else setAutoIngest(true);
      if (s.reader) {
        if (typeof s.reader.rememberPos === "boolean") setRememberPos(s.reader.rememberPos);
        if (typeof s.reader.defaultZoom === "number") setDefaultZoom(s.reader.defaultZoom);
        if (typeof s.reader.nightInvert === "boolean") setNightInvert(s.reader.nightInvert);
      }
    }).catch(() => {});
    refreshKeysStatus();
    refreshLlmKeyStatus();
    return () => { alive = false; };
  }, [refreshKeysStatus, refreshLlmKeyStatus]);

  useEffect(() => { refreshLlmKeyStatus(provider); }, [provider, refreshLlmKeyStatus]);

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    bridge.getUserDataPath().then((p) => { if (alive && p) setUserDataPath(String(p)); }).catch(() => {});
    bridge.getAppVersion().then((v) => { if (alive && v) setAppVersion(String(v)); }).catch(() => {});
    return () => { alive = false; };
  }, [backend]);

  const onPickProvider = async (id) => {
    const prev = { provider, model, baseUrl };
    const p = presetOf(id);
    setProvider(id);
    setModel(p.model);
    setBaseUrl(p.showBase ? (id === "ollama" ? "" : "") : "");
    setApiKey("");
    await persistLlmFields({ provider: id, model: p.model, baseUrl: p.showBase ? (id === "ollama" ? "" : "") : "" }, () => {
      setProvider(prev.provider);
      setModel(prev.model);
      setBaseUrl(prev.baseUrl);
    });
    refreshLlmKeyStatus(id);
  };

  const fetchModels = useCallback(async () => {
    const pr = presetOf(provider);
    setModelsLoading(true);
    try {
      const res = await bridge.listModels({ provider, baseUrl: pr.showBase ? (baseUrl.trim() || undefined) : undefined, apiKey: apiKey.trim() || undefined });
      if (res && res.ok && Array.isArray(res.models) && res.models.length) setFetchedModels(res.models);
      else setFetchedModels(null);
    } catch (e) { setFetchedModels(null); }
    finally { setModelsLoading(false); }
  }, [provider, baseUrl, apiKey]);
  // 切换供应商即拉取（有 key / Ollama 返回真列表；无 key 静默回落内置清单）。
  useEffect(() => { setFetchedModels(null); setCustomMode(false); setModelMenuOpen(false); fetchModels(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider]);
  const preset = presetOf(provider);
  const availModels = (fetchedModels && fetchedModels.length) ? fetchedModels : (MODEL_PRESETS[provider] || []);
  const showCustomInput = customMode || (!!model && !availModels.includes(model)); // 自填/自定义模型能力标记（provider_translate 契约）

  const saveLlm = useCallback(async () => {
    setSavingLlm(true);
    try {
      const pr = presetOf(provider);
      const llm = buildLlmPayload();
      const r = await persistSettings((cur) => ({ ...cur, llm: { ...(cur.llm || {}), ...llm } }));
      if (!r.ok && backend) { pushToast && pushToast("保存失败"); return; }
      const wroteKey = preset.needsKey && !!apiKey.trim();
      if (wroteKey) {
        await bridge.setSecret(provider + "_key", apiKey.trim());
        setApiKey("");
        setLlmKeySaved(true);
      }
      await refreshLlmKeyStatus();
      pushToast && pushToast(backend ? (wroteKey ? "已保存大模型设置，密钥已写入钥匙串" : "已保存大模型设置") : "（原型）未接后端，设置未持久化");
    } catch (e) { pushToast && pushToast("保存失败"); }
    finally { setSavingLlm(false); }
  }, [provider, model, baseUrl, apiKey, preset, backend, pushToast, visionConsent, refreshLlmKeyStatus, buildLlmPayload]);

  const onTestLlm = useCallback(async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await bridge.testLlm({ provider, model: (model || preset.model).trim(), baseUrl: preset.showBase ? baseUrl.trim() : undefined, apiKey: apiKey.trim() || undefined });
      setTestResult(res && typeof res.ok === "boolean" ? res : { ok: false, error: "无响应" });
    } catch (e) { setTestResult({ ok: false, error: "测试失败" }); }
    finally { setTesting(false); }
  }, [provider, model, baseUrl, apiKey, preset]);

  const saveGeneral = useCallback(async () => {
    setSavingGen(true);
    try {
      const r = await persistSettings((cur) => ({
        ...cur,
        contactEmail: contactEmail.trim() || undefined,
      }));
      if (!r.ok && backend) { pushToast && pushToast("保存失败"); return; }
      pushToast && pushToast(backend ? "已保存联络邮箱" : "（原型）未接后端，设置未持久化");
    } catch (e) { pushToast && pushToast("保存失败"); }
    finally { setSavingGen(false); }
  }, [contactEmail, backend, pushToast]);

  // 弹窗 Esc 关闭：用捕获阶段 + stopImmediatePropagation，先于阅读器(window 冒泡)处理，避免误触底层阅读器的 Esc。
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const onResetLocalData = useCallback(async () => {
    if (!backend) { pushToast && pushToast("需 Electron 引擎"); return; }
    setResetConfirmOpen(true);
  }, [backend, pushToast]);

  const confirmResetLocalData = useCallback(async () => {
    setResetConfirmOpen(false);
    setResetting(true);
    try {
      const r = await bridge.resetLocalData();
      if (!r || !r.ok) pushToast && pushToast("清除失败：" + ((r && r.error) || "未知错误"));
    } catch (e) { pushToast && pushToast("清除失败"); }
    finally { setResetting(false); }
  }, [pushToast]);

  return (
    <div className="set-backdrop" onClick={onClose}>
      <div className="set-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="设置">
        <style>{SET_CSS}</style>
        <div className="set-modal-head">
          <h1 className="set-h1">设置</h1>
          <button className="set-close" onClick={onClose} aria-label="关闭设置" title="关闭 (Esc)"><X size={18} /></button>
        </div>
        <div className="set-modal-body">
          <nav className="set-rail" role="tablist" aria-label="设置分类">
            {CATS.map((c) => (
              <button key={c.id} role="tab" aria-selected={activeCat === c.id} className={"set-railbtn" + (activeCat === c.id ? " on" : "")} onClick={() => setActiveCat(c.id)}>
                <c.icon size={16} /> {c.label}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {!backend && (
              <div className="set-note set-warn"><Info size={15} /><span className="set-note-t">当前未连接引擎（原型模式）：设置可填写与即时应用主题，但不会持久化；密钥也不会写入钥匙串。接入 Electron 引擎后生效。</span></div>
            )}

            {activeCat === "llm" && (
              <>
                <h2 className="set-pane-h"><Cpu size={18} /> 大模型</h2>
                <p className="set-sec-d">选择提供方并填模型；密钥仅写入系统钥匙串，绝不进配置或代码（红线3）。AI 总结 / 问答 / 翻译都用此配置。</p>
                <div className="set-row">
                  <span className="set-lbl">提供方</span>
                  <div className="set-provs">
                    {PROVIDERS.map((p) => (
                      <button key={p.id} className={"set-prov" + (provider === p.id ? " on" : "")} onClick={() => onPickProvider(p.id)}>{p.label}</button>
                    ))}
                  </div>
                </div>
                <div className="set-row">
                  <span className="set-lbl">模型 <span className="set-lbl-sub">· 点选；可刷新拉取最新，或自填</span></span>
                  <div className="set-combo">
                    <input className="set-combo-in set-mono" value={model} onChange={(e) => { setModel(e.target.value); scheduleLlmBlurSave({ model: e.target.value }); }} onBlur={() => void persistLlmFields({ model })} onFocus={() => setModelMenuOpen(true)} placeholder={preset.model || "模型名（点选或直接输入）"} aria-label="模型名" />
                    <button type="button" className="set-combo-tg" onClick={() => setModelMenuOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={modelMenuOpen} title="模型列表"><ChevronDown size={14} /></button>
                    <button type="button" className="set-combo-rf" onClick={() => fetchModels()} disabled={modelsLoading} title="拉取最新模型列表"><span className={modelsLoading ? "set-spin" : ""}>{modelsLoading ? <Loader size={14} /> : <RefreshCw size={14} />}</span></button>
                    {modelMenuOpen && (
                      <div className="set-combo-menu" role="listbox">
                        {availModels.map((m) => (
                          <button type="button" role="option" aria-selected={m === model} key={m} className={"set-combo-opt set-mono" + (m === model ? " on" : "")} onClick={() => { const prev = model; setModel(m); setModelMenuOpen(false); void persistLlmFields({ model: m }, () => setModel(prev)); }}>{m}{m === model ? <Check size={13} /> : null}</button>
                        ))}
                        {availModels.length === 0 && <div className="set-combo-note">可直接在框内输入模型名</div>}
                      </div>
                    )}
                  </div>
                  {provider === "doubao" && (
                    <span className="set-hint">
                      「模型」可填 <b>Model ID</b>（模型广场，如 <span className="set-mono">doubao-seed-2-1-pro-260628</span>）或<b>推理接入点 ID</b>（在线推理，<span className="set-mono">ep-</span> 开头）——二者都填入此框、二选一。账户未开通的 Model ID 会 404；自建 <span className="set-mono">ep-</span> 接入点在账号内一定可用，<b>推荐</b>。
                      {model.trim().startsWith("ep-") && <span className="set-ep-ok"><br />✓ 已识别为<b>推理接入点 ID</b>（ep-，在线推理）。</span>}
                    </span>
                  )}
                </div>
                {preset.showBase && (
                  <div className="set-row">
                    <span className="set-lbl">Base URL{preset.baseRequired ? "（必填）" : "（可选，默认 " + (preset.base || "") + "）"}</span>
                    <input className="set-in set-mono" value={baseUrl} placeholder={preset.base || "https://…/v1"} onChange={(e) => { setBaseUrl(e.target.value); scheduleLlmBlurSave({ baseUrl: e.target.value }); }} onBlur={() => void persistLlmFields({ baseUrl })} />
                  </div>
                )}
                {preset.needsKey && (
                  <div className="set-row">
                    <span className="set-lbl">API Key{llmKeySaved ? <span className="set-key-st ok" style={{ display: "inline", marginLeft: 8 }}>✓ 已写入钥匙串</span> : null}</span>
                    <div className="set-key">
                      <KeyRound size={16} />
                      <input className="set-in set-mono" type={showKey ? "text" : "password"} value={apiKey}
                        placeholder={llmKeySaved ? "已保存（输入新值可覆盖；不回显明文）" : "粘贴密钥（保存后写入系统钥匙串，不回显）"}
                        onChange={(e) => setApiKey(e.target.value)} />
                      <button type="button" className="set-key-eye" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "隐藏密钥" : "显示密钥"} title={showKey ? "隐藏" : "显示"}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                    </div>
                    <span className="set-hint">留空＝保持现有密钥不变；填入新值并保存＝更新。密钥不会回显、不写入任何配置文件（红线3）。</span>
                  </div>
                )}
                <div className="set-btnrow">
                  <button className="set-btn" onClick={saveLlm} disabled={savingLlm}><Save size={15} /> {savingLlm ? "保存中…" : "保存大模型设置"}</button>
                  <button className="set-btn2" onClick={onTestLlm} disabled={testing} title="用当前填写或已存的配置做一次极小调用，验证密钥/模型/网络是否通"><Plug size={15} /> {testing ? "测试中…" : "测试连接"}</button>
                </div>
                {testResult && <div className={"set-test" + (testResult.ok ? " ok" : " err")}>{testResult.ok ? ("✓ 连接成功 · " + testResult.model + (testResult.ms ? " · " + testResult.ms + " ms" : "")) : ("✗ " + (testResult.error || "连接失败"))}</div>}
              </>
            )}

            {activeCat === "sources" && (
              <>
                <div className="set-row">
                  <span className="set-lbl"><Mail size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />学者联络方式（推荐）</span>
                  <input className="set-in" type="email" value={contactEmail} placeholder="you@example.org" onChange={(e) => setContactEmail(e.target.value)} />
                  <span className="set-hint">用于 Unpaywall、PubMed、Crossref、OpenAlex 等 API 礼貌标识；仅本机保存，不上传云端。可用机构邮箱。</span>
                </div>
                <div className="set-btnrow" style={{ marginBottom: 16 }}>
                  <button className="set-btn2" onClick={saveGeneral} disabled={savingGen}><Save size={15} /> {savingGen ? "保存中…" : "保存联络邮箱"}</button>
                </div>
                <SourceKeysPanel
                  configured={keysConfigured}
                  depth={searchDepth}
                  onSaveKey={async (name, val) => { await bridge.setSecret(name, val); await refreshKeysStatus(); pushToast && pushToast("密钥已写入钥匙串"); }}
                  onTestKey={(name, cand) => bridge.testSource(name, cand)}
                  onOpenUrl={(u) => bridge.openExternal(u)}
                  onChangeDepth={async (d) => {
                    setSearchDepth(d);
                    await persistSettings((cur) => ({ ...cur, searchDepth: d }));
                    pushToast && pushToast("检索深度已更新");
                  }}
                />
                <MirrorSettingsPanel
                  value={altMirrors}
                  pushToast={pushToast}
                  onProbe={() => bridge.probeMirrors()}
                  onSave={async (mirrors) => {
                    await persistSettings((cur) => ({ ...cur, altMirrors: mirrors }));
                    setAltMirrors(mirrors);
                  }}
                />
                <PrefetchToggleRow
                  value={prefetchOnIdentifier}
                  onChange={async (v) => {
                    setPrefetchOnIdentifier(v);
                    await persistSettings((cur) => ({ ...cur, prefetchOnIdentifier: v }));
                    pushToast && pushToast(v ? "已开启定位预取" : "已关闭定位预取");
                  }}
                />
                <OaPrefetchToggleRow
                  value={prefetchOaResults}
                  onChange={async (v) => {
                    setPrefetchOaResults(v);
                    await persistSettings((cur) => ({ ...cur, prefetchOaResults: v }));
                    pushToast && pushToast(v ? "已开启 OA 检索预取" : "已关闭 OA 检索预取");
                  }}
                />
                <PrimaryAutoOpenToggleRow
                  value={primaryAutoOpenReader}
                  onChange={async (v) => {
                    setPrimaryAutoOpenReader(v);
                    await persistSettings((cur) => ({ ...cur, primaryAutoOpenReader: v }));
                    pushToast && pushToast(v ? "定位成功后自动打开阅读器" : "已关闭自动打开阅读器");
                  }}
                />
                <SourceTogglesPanel
                  keysConfigured={keysConfigured}
                  pushToast={pushToast}
                  onSaveDisabled={async (disabledSources) => {
                    await persistSettings((cur) => ({ ...cur, disabledSources }));
                  }}
                />
              </>
            )}

            {activeCat === "reader" && (
              <>
                <h2 className="set-pane-h"><BookOpen size={18} /> 阅读</h2>
                <p className="set-sec-d">阅读器的默认行为与快捷键。开关与缩放切换后立即保存，对新打开的文献生效。</p>
                <div className="set-kv">
                  <div className="set-kv-main"><span className="set-lbl">记住阅读位置</span><span className="set-kv-d">重开同一篇时回到上次页码（按文献分别记忆）。</span></div>
                  <button role="switch" aria-checked={rememberPos} className={"set-switch" + (rememberPos ? " on" : "")} onClick={() => void onToggleRememberPos()} aria-label="记住阅读位置开关"><i /></button>
                </div>
                <div className="set-kv">
                  <div className="set-kv-main"><span className="set-lbl">默认缩放</span><span className="set-kv-d">打开文献时的初始缩放比例。</span></div>
                  <div className="set-seg">
                    {[["100%", 1], ["110%", 1.1], ["125%", 1.25], ["150%", 1.5]].map(([lbl, val]) => (
                      <button key={lbl} className={defaultZoom === val ? "on" : ""} onClick={() => void onPickDefaultZoom(val)}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div className="set-kv">
                  <div className="set-kv-main"><span className="set-lbl">夜读反色（默认）</span><span className="set-kv-d">深色环境下反相页面，减轻白底刺眼；阅读器内也可随时切换。</span></div>
                  <button role="switch" aria-checked={nightInvert} className={"set-switch" + (nightInvert ? " on" : "")} onClick={() => void onToggleNightInvert()} aria-label="夜读反色默认开关"><i /></button>
                </div>
                <div className="set-kv">
                  <div className="set-kv-main"><span className="set-lbl">清除继续阅读</span><span className="set-kv-d">移除阅读落地页的「继续阅读」列表；不影响已下载 PDF、批注与页码记忆。</span></div>
                  <button type="button" className="set-btn2 set-btn-danger" disabled={!backend} onClick={() => void onClearContinueReading()}>清除记录</button>
                </div>
                <div className="set-row">
                  <span className="set-lbl">键盘快捷键</span>
                  <div>
                    <div className="set-kbd-row"><span>查找</span><span className="set-kbd">Ctrl / ⌘ + F</span></div>
                    <div className="set-kbd-row"><span>首页 / 末页</span><span className="set-kbd">Home / End</span></div>
                    <div className="set-kbd-row"><span>上一页 / 下一页</span><span className="set-kbd">← → · PgUp / PgDn</span></div>
                    <div className="set-kbd-row"><span>放大 / 缩小</span><span className="set-kbd">Ctrl / ⌘ + = / -</span></div>
                    <div className="set-kbd-row"><span>适配宽度</span><span className="set-kbd">Ctrl / ⌘ + 0</span></div>
                  </div>
                </div>
              </>
            )}

            {activeCat === "appearance" && (
              <>
                <h2 className="set-pane-h"><Palette size={18} /> 外观</h2>
                <p className="set-sec-d">点选即时切换并保存。晴台为默认亮色；暖夜 / 薄暮 / 松林为深色。</p>
                <div className="set-themes">
                  {THEMES.map((t) => (
                    <div key={t.id} className={"set-theme" + (theme === t.id ? " on" : "")} onClick={() => onTheme && onTheme(t.id)}>
                      <div className="set-sw">{(t.swatch || []).map((c, i) => <span key={i} style={{ background: c }} />)}</div>
                      <div className="set-theme-nm">{t.name}{theme === t.id ? <Check size={14} className="ck" /> : null}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeCat === "privacy" && (
              <>
                <h2 className="set-pane-h"><Shield size={18} /> 隐私</h2>
                <p className="set-sec-d">Lumina 本地优先：数据、PDF 与索引都在本机。唯一会出网的是你主动配置的云端模型调用。</p>
                <div className="set-toggle">
                  <span className="set-lbl"><Eye size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />允许云端读图（把图表图像发送到云端视觉模型分析）</span>
                  <button role="switch" aria-checked={visionConsent} className={"set-switch" + (visionConsent ? " on" : "")} onClick={() => void onToggleVisionConsent()} aria-label="云端读图开关"><i /></button>
                </div>
                <span className="set-hint">默认关闭，守本地优先（红线7）：关闭时图表分析仅用本地视觉模型（Ollama），图像不出本机；开启后才允许把图像发往所选云端模型。切换后立即保存。</span>
                {visionConsent && provider === "doubao" && (
                  <div className="set-note"><Info size={15} /><span className="set-note-t">豆包（火山方舟）支持读图，但需选用<b>视觉 / 多模态模型</b>（如 <span className="set-mono">doubao-seed-*</span> 或 <span className="set-mono">doubao-*-vision-*</span>）；纯文本 pro 会拒绝图像。下拉仅列常用 Model ID；其他 ID 或 <span className="set-mono">ep-</span> 接入点请自填。</span></div>
                )}
                {visionConsent && !["openai", "anthropic", "ollama"].includes(provider) && provider !== "doubao" && (
                  <div className="set-note set-warn"><Info size={15} /><span className="set-note-t">当前所选「{preset.label}」多为纯文本模型，可能不支持读图：图表分析需 OpenAI / Anthropic 的视觉模型，或本地 Ollama 多模态模型（如 llava / qwen2-vl）。纯文本模型（如 deepseek-v4-flash）会返回「不支持视觉输入」。</span></div>
                )}
                <div className="set-btnrow">
                  <button className="set-btn" onClick={saveLlm} disabled={savingLlm}><Save size={15} /> {savingLlm ? "保存中…" : "保存大模型设置"}</button>
                </div>
                <div className="set-note"><Info size={15} /><span className="set-note-t">密钥安全：保存时写入系统钥匙串或环境变量，界面不回显；绝不写入配置文件或代码。</span></div>
              </>
            )}

            {activeCat === "general" && (
              <>
                <h2 className="set-pane-h"><Bell size={18} /> 通用</h2>
                <div className="set-toggle">
                  <span className="set-lbl">取文后自动加入「我的文献」工作集</span>
                  <button role="switch" aria-checked={autoIngest} className={"set-switch" + (autoIngest ? " on" : "")} onClick={() => void onToggleAutoIngest()} aria-label="自动入库开关"><i /></button>
                </div>
                <span className="set-hint">开启后，获取全文成功时会自动写入工作集并记录来源；关闭则仅保存 PDF 到本机，需手动收藏。切换后立即保存。</span>
                <div className="set-toggle">
                  <span className="set-lbl">桌面通知（订阅简报等）</span>
                  <button role="switch" aria-checked={notifications} className={"set-switch" + (notifications ? " on" : "")} onClick={() => void onToggleNotifications()} aria-label="通知开关"><i /></button>
                </div>
                <div className="set-row">
                  <span className="set-lbl">订阅简报通知档位</span>
                  <div className="set-seg">
                    {[["calm", "安静"], ["regular", "标准"], ["power", "积极"]].map(([k, l]) => (
                      <button key={k} type="button" className={digestNotifyTier === k ? "on" : ""} onClick={() => void onPickDigestTier(k)}>{l}</button>
                    ))}
                  </div>
                  <span className="set-hint">安静：仅 app 内简报 · 标准：每次调度汇总一条 · 积极：每个订阅单独通知</span>
                </div>
                <div className="set-toggle">
                  <span className="set-lbl">检索完成后自动生成「今日简报总报告」</span>
                  <button role="switch" aria-checked={digestReportAuto} className={"set-switch" + (digestReportAuto ? " on" : "")} onClick={() => void onToggleDigestReportAuto()} aria-label="自动生成简报总报告"><i /></button>
                </div>
                <span className="set-hint">与每条「相关说明」分开：总报告归纳今日全部待读（基于标题+摘要）。关闭后仍可在简报页手动生成。默认开启。</span>
                <div className="set-toggle">
                  <span className="set-lbl">关闭时最小化到托盘后台运行（订阅检索与每日简报继续）</span>
                  <button role="switch" aria-checked={bgTray} className={"set-switch" + (bgTray ? " on" : "")} onClick={() => void onToggleBgTray()} aria-label="后台运行开关"><i /></button>
                </div>
                <div className="set-toggle">
                  <span className="set-lbl">开机时自动启动 Lumina</span>
                  <button role="switch" aria-checked={bgLogin} className={"set-switch" + (bgLogin ? " on" : "")} onClick={() => void onToggleBgLogin()} aria-label="开机自启开关"><i /></button>
                </div>
                <span className="set-hint">后台运行：关主窗口后驻留系统托盘，订阅按计划检索、有新发表时桌面通知；从托盘可重新打开或退出。开关切换后立即生效并保存。托盘/自启为系统级，需打包后真机验证（Linux 自启支持有限）。</span>
                <div className="set-row">
                  <span className="set-lbl"><Mail size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />联系邮箱（用于 OA 取文的礼貌池标识，可选）</span>
                  <input className="set-in" type="email" value={contactEmail} placeholder="you@example.org" onChange={(e) => setContactEmail(e.target.value)} />
                </div>
                <button className="set-btn" onClick={saveGeneral} disabled={savingGen}><Save size={15} /> {savingGen ? "保存中…" : "保存联络邮箱"}</button>
                <div className="set-note" style={{ marginTop: 16 }}><Info size={15} /><span className="set-note-t">本机数据保存在：<span className="set-mono">{userDataPath || "（启动后显示实际路径）"}</span> — 文献库、已下载 PDF 与阅读缓存均在此目录，不会上传云端。</span></div>
                <button className="set-btn set-btn-danger" onClick={onResetLocalData} disabled={resetting || !backend}><Trash2 size={15} /> {resetting ? "正在清除…" : "清除本机文献数据并重启"}</button>
                <span className="set-hint">删除文献库、订阅、收藏、已下载 PDF 与阅读缓存；不删除大模型密钥与通用设置。</span>
              </>
            )}

            {activeCat === "about" && (
              <>
                <h2 className="set-pane-h"><Info size={18} /> 关于</h2>
                <div className="set-about">
                  <p><b>Lumina Feed{appVersion ? ` ${appVersion}` : ""}</b> —— 本地优先的个人文献工具：定位一篇 → 多源取全文 PDF → AI 照亮（读 / 译 / 总结 / 批注）+ 主题订阅 + 每日简报。</p>
                  {userDataPath ? (
                    <p className="set-mono" style={{ marginTop: 10, fontSize: 12.5, wordBreak: "break-all" }}>本机数据：{userDataPath}</p>
                  ) : null}
                  <p style={{ marginTop: 10 }}>检索覆盖 20 个来源（开放 API 与 LibGen、Anna's Archive、Sci-Hub 等）；不包含 Google Scholar 索引或 Web of Science / Scopus 等商业数据库。取文来源会在界面持久标注。</p>
                  <p style={{ marginTop: 10 }}><b>底线（始终成立）</b></p>
                  <p>· 全文按 OA → LibGen → Anna's Archive → Sci-Hub 顺序自动尝试；<br />· AI 只排序 / 总结，从不替你裁决纳入或排除；<br />· 密钥只入 OS 钥匙串，绝不写配置或代码；<br />· 每条总结都带依据徽章与页码引用，可回原文核对；<br />· 预印本标注「未经同行评议」、已撤稿明确提示；<br />· 数据、PDF 与索引都在本机。</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={resetConfirmOpen}
        title="清除本机文献数据？"
        detail="将删除本机文献库、订阅、收藏、已下载 PDF 与阅读缓存，并重启应用。大模型密钥与通用设置保留。此操作不可恢复。"
        confirmLabel="清除"
        cancelLabel="取消"
        danger
        onConfirm={confirmResetLocalData}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
