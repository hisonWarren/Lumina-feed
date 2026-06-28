// open-sources · 联络邮箱三触点（P0 / review F-P0）。单一文案模板，三种形态，互斥首次标记。
//   variant="onboarding" 首次启动卡片 · "search" 结果区细条 · "fetch" 取文失败 inline。
// 邮箱仅本机保存（settings.contactEmail，非密钥）；用于 Unpaywall / Crossref·OpenAlex polite pool。
// 不阻断主路径：均可「稍后」。文案诚实：可用机构邮箱、仅本机、Unpaywall 官方要求。
import React, { useState } from "react";

const COPY = {
  title: "学者联络方式（仅本机保存）",
  body: "Unpaywall 等开放全文源要求一个联系邮箱（礼貌池）。可填机构邮箱；只存在你的电脑上，不上传、不外发。",
  ph: "you@example.org",
  save: "保存", later: "稍后", fix: "去填写",
};

export default function EmailPrompt({ variant = "onboarding", initialEmail = "", onSave, onDismiss }) {
  const [email, setEmail] = useState(initialEmail);
  const [saving, setSaving] = useState(false);
  const valid = /\S+@\S+\.\S+/.test(email.trim());
  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try { onSave && (await onSave(email.trim())); } finally { setSaving(false); }
  };

  if (variant === "search") {
    return (
      <div className="lf-email-bar">
        <span className="t">填一个联系邮箱即可解锁 Unpaywall 等更多合法全文源（仅本机）。</span>
        <button className="lf-email-fix" onClick={() => onDismiss && onDismiss("open")}>{COPY.fix}</button>
        <button className="lf-email-x" aria-label="稍后" onClick={() => onDismiss && onDismiss("later")}>×</button>
      </div>
    );
  }
  if (variant === "fetch") {
    return (
      <div className="lf-email-inline">
        <div className="hd">填邮箱解锁 Unpaywall 取文</div>
        <div className="rw">
          <input className="lf-email-in" type="email" value={email} placeholder={COPY.ph} onChange={(e) => setEmail(e.target.value)} />
          <button className="lf-email-save" disabled={!valid || saving} onClick={save}>{saving ? "保存中…" : COPY.save}</button>
        </div>
        <button className="lf-email-deep" onClick={() => onDismiss && onDismiss("settings")}>在设置 → 数据源 中管理</button>
      </div>
    );
  }
  // onboarding card
  return (
    <div className="lf-email-card" role="dialog" aria-label={COPY.title}>
      <div className="hd">{COPY.title}</div>
      <p className="bd">{COPY.body}</p>
      <div className="rw">
        <input className="lf-email-in" type="email" value={email} placeholder={COPY.ph} onChange={(e) => setEmail(e.target.value)} />
        <button className="lf-email-save" disabled={!valid || saving} onClick={save}>{saving ? "保存中…" : COPY.save}</button>
      </div>
      <button className="lf-email-later" onClick={() => onDismiss && onDismiss("later")}>{COPY.later}</button>
    </div>
  );
}
