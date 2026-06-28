// P8 · 20 源细粒度开关
import React, { useEffect, useState, useCallback } from "react";
import { bridge, hasBackend } from "../lumina-bridge.js";

const FALLBACK_REGISTRY = [
  { id: "pubmed", label: "PubMed" }, { id: "europepmc", label: "Europe PMC" },
  { id: "crossref", label: "Crossref" }, { id: "openalex", label: "OpenAlex" },
  { id: "arxiv", label: "arXiv" }, { id: "biorxiv", label: "bioRxiv" },
  { id: "medrxiv", label: "medRxiv" }, { id: "semanticscholar", label: "Semantic Scholar", slow: true },
  { id: "doaj", label: "DOAJ" }, { id: "datacite", label: "DataCite" },
  { id: "core", label: "CORE", requiresKey: "core_key", slow: true, defaultEnabled: false },
  { id: "lens", label: "Lens.org", requiresKey: "lens_token", slow: true, defaultEnabled: false },
  { id: "hal", label: "HAL" }, { id: "osf", label: "OSF Preprints" },
  { id: "zenodo", label: "Zenodo", slow: true }, { id: "openaire", label: "OpenAIRE", slow: true },
  { id: "dblp", label: "DBLP" }, { id: "libgen", label: "LibGen", slow: true },
  { id: "annas", label: "Anna's Archive", slow: true }, { id: "scihub", label: "Sci-Hub" },
];

export default function SourceTogglesPanel({ keysConfigured = {}, pushToast, onSaveDisabled }) {
  const [registry, setRegistry] = useState(FALLBACK_REGISTRY);
  const [enabled, setEnabled] = useState(() => Object.fromEntries(FALLBACK_REGISTRY.map((r) => [r.id, true])));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hasBackend() || !bridge.sourcesRegistry) return;
    let alive = true;
    bridge.sourcesRegistry().then((rows) => {
      if (!alive || !Array.isArray(rows) || !rows.length) return;
      setRegistry(rows);
      setEnabled(Object.fromEntries(rows.map((r) => [r.id, r.enabled !== false])));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const persistEnabled = useCallback(async (nextMap) => {
    if (!onSaveDisabled) return;
    setSaving(true);
    try {
      const disabledSources = registry.filter((r) => nextMap[r.id] === false).map((r) => r.id);
      await onSaveDisabled(disabledSources);
    } catch {
      pushToast && pushToast("检索源开关保存失败");
    } finally { setSaving(false); }
  }, [registry, onSaveDisabled, pushToast]);

  const toggle = useCallback((id) => {
    setEnabled((m) => {
      const next = { ...m, [id]: !m[id] };
      void persistEnabled(next);
      return next;
    });
  }, [persistEnabled]);

  const enabledCount = registry.filter((r) => enabled[r.id] !== false).length;

  return (
    <div className="lf-src-toggles set-sec">
      <div className="set-sec-t">检索源开关（{enabledCount}/{registry.length} 已启用）{saving ? " · 保存中…" : ""}</div>
      <p className="set-hint">关闭的源不会参与关键词检索与单源重试；标识符直达与手动取文不受影响。切换后立即保存。</p>
      <div className="lf-src-grid">
        {registry.map((row) => {
          const on = enabled[row.id] !== false;
          const needsKey = row.requiresKey && !keysConfigured[row.requiresKey];
          return (
            <div key={row.id} className={"lf-src-row" + (on ? "" : " off")}>
              <div className="lf-src-main">
                <span className="lf-src-name">{row.label}</span>
                <span className="lf-src-tags">
                  {row.slow && <span className="lf-src-tag slow">慢源</span>}
                  {row.requiresKey && <span className="lf-src-tag key">需密钥</span>}
                  {needsKey && <span className="lf-src-tag warn">未配置</span>}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                className={"set-switch" + (on ? " on" : "")}
                onClick={() => toggle(row.id)}
                disabled={saving}
                aria-label={`${row.label} ${on ? "已启用" : "已禁用"}`}
              >
                <i />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** P10 · 标识符直达预取开关 */
export function PrefetchToggleRow({ value, onChange }) {
  const on = !!value;
  return (
    <div className="set-kv lf-prefetch-row">
      <div className="set-kv-main">
        <span className="set-lbl">标识符直达预取全文</span>
        <span className="set-kv-d">DOI / PMID / arXiv 解析成功后，后台静默尝试获取 PDF；卡片显示「全文就绪」。默认关闭。</span>
      </div>
      <button role="switch" aria-checked={on} className={"set-switch" + (on ? " on" : "")} onClick={() => onChange(!on)} aria-label="标识符预取开关"><i /></button>
    </div>
  );
}
