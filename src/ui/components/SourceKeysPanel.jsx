// open-sources · 设置「数据源」面板（修 review F1 红线3 + F14 Key UX）。
// 关键：API Key 一律经 bridge.setSecret(name,value) 写入 OS 钥匙串，*绝不*写入 AppSettings/配置（红线3）。
//   - 与既有「大模型」Key 完全相同的存储路径（Settings.jsx 既有 setSecret 模式）。
//   - 每个 Key 配「获取 Key →」外链 + 「测试」连通（sources:test，见 WIRING）。
//   - 邮箱与检索深度走 settings:save（非密钥）；面板只显示「已配置」布尔，不回显 Key 明文。
import React, { useState } from "react";
import SearchDepthToggle from "./SearchDepthToggle.jsx";

const KEYS = [
  { secret: "semanticscholar_key", label: "Semantic Scholar Key", need: "可选", hint: "无也可用，配置后限速更稳", url: "https://www.semanticscholar.org/product/api" },
  { secret: "ncbi_key",            label: "NCBI API Key",         need: "可选", hint: "PubMed 提速（3→10 req/s）", url: "https://www.ncbi.nlm.nih.gov/account/settings/" },
  { secret: "core_key",            label: "CORE API Key",         need: "必填才启用", hint: "无则跳过 CORE 源", url: "https://core.ac.uk/services/api" },
  { secret: "lens_token",          label: "Lens.org Token",       need: "必填才启用", hint: "无则跳过 Lens 源", url: "https://www.lens.org/lens/user/subscriptions" },
];

function KeyRow({ row, configured, onSave, onTest, onOpen }) {
  const [val, setVal] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(configured ? "已配置" : "");
  const save = async () => {
    if (!val.trim()) return;
    setBusy(true);
    try { await onSave(row.secret, val.trim()); setVal(""); setResult("已配置"); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const r = await onTest(row.secret, val.trim() || undefined); setResult(r && r.ok ? "连通 ✓" : "未连通"); } finally { setBusy(false); }
  };
  return (
    <div className="lf-keyrow">
      <div className="lf-keyrow-h">
        <span className="nm">{row.label}</span>
        <span className="need">{row.need}</span>
        <button className="lf-getkey" onClick={() => onOpen(row.url)}>获取 Key →</button>
      </div>
      <div className="lf-keyrow-i">
        <input className="lf-key-in set-mono" type={show ? "text" : "password"} value={val}
               placeholder={configured ? "已保存（保存新值将覆盖；不回显）" : "粘贴密钥（写入系统钥匙串，不回显）"}
               onChange={(e) => setVal(e.target.value)} />
        <button className="lf-key-eye" onClick={() => setShow((s) => !s)} aria-label="显示/隐藏">{show ? "隐藏" : "显示"}</button>
        <button className="lf-key-save" disabled={!val.trim() || busy} onClick={save}>保存</button>
        <button className="lf-key-test" disabled={busy} onClick={test}>测试</button>
      </div>
      <div className="lf-keyrow-f">
        <span className="hint">{row.hint}</span>
        {result ? <span className={"st " + (result.includes("✓") || result === "已配置" ? "ok" : "bad")}>{result}</span> : null}
      </div>
    </div>
  );
}

export default function SourceKeysPanel({ configured = {}, depth = "standard", onSaveKey, onTestKey, onOpenUrl, onChangeDepth }) {
  return (
    <div className="lf-sources-panel">
      <h2 className="set-pane-h">数据源</h2>
      <p className="set-sec-d">开放学术源的 API Key 与检索深度。密钥只写入系统钥匙串，绝不写入配置文件或代码（红线 3）。</p>

      <div className="set-sec">
        <div className="set-sec-t">检索深度</div>
        <SearchDepthToggle value={depth} onChange={onChangeDepth} />
      </div>

      <div className="set-sec">
        <div className="set-sec-t">API 密钥（均为可选；未配置的数据源自动跳过，不影响其他检索）</div>
        {KEYS.map((row) => (
          <KeyRow key={row.secret} row={row} configured={!!configured[row.secret]}
                  onSave={onSaveKey} onTest={onTestKey} onOpen={onOpenUrl} />
        ))}
      </div>

      <div className="set-note"><span className="set-note-t">密钥安全：保存时写入系统钥匙串或环境变量，界面不回显；绝不写入配置文件或代码。</span></div>
    </div>
  );
}
