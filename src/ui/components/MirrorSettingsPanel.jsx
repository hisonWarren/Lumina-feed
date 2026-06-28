// P5 · 全文库镜像设置与探活
import React, { useState, useEffect } from "react";
import { RefreshCw, Save } from "lucide-react";

const ROWS = [
  { key: "libgen", label: "LibGen 镜像", placeholder: "https://libgen.li\n每行一个 URL" },
  { key: "annas", label: "Anna's Archive 镜像", placeholder: "https://annas-archive.gl" },
  { key: "scihub", label: "Sci-Hub 镜像", placeholder: "https://sci-hub.se" },
];

function linesToArr(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function arrToLines(arr) {
  return (arr || []).join("\n");
}

export default function MirrorSettingsPanel({ value = {}, onSave, onProbe, pushToast }) {
  const [draft, setDraft] = useState(() => ({
    libgen: arrToLines(value.libgen),
    annas: arrToLines(value.annas),
    scihub: arrToLines(value.scihub),
  }));
  const [probes, setProbes] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft({
      libgen: arrToLines(value.libgen),
      annas: arrToLines(value.annas),
      scihub: arrToLines(value.scihub),
    });
  }, [value]);

  const save = async () => {
    const altMirrors = {
      libgen: linesToArr(draft.libgen),
      annas: linesToArr(draft.annas),
      scihub: linesToArr(draft.scihub),
    };
    await onSave(altMirrors);
    pushToast && pushToast("镜像列表已保存");
  };

  const probe = async () => {
    setBusy(true);
    try {
      const r = await onProbe();
      setProbes(r || null);
    } finally { setBusy(false); }
  };

  return (
    <div className="lf-mirror-panel set-sec">
      <div className="set-sec-t">全文库镜像（LibGen / Anna / Sci-Hub）</div>
      <p className="set-hint">留空则使用内置默认列表；保存后取文与检索会按探活延迟自动排序镜像。</p>
      {ROWS.map((row) => (
        <div key={row.key} className="lf-mirror-row">
          <label className="set-lbl">{row.label}</label>
          <textarea
            className="set-in set-mono lf-mirror-ta"
            rows={3}
            placeholder={row.placeholder}
            value={draft[row.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
          />
          {probes && probes[row.key] && (
            <div className="lf-mirror-probes">
              {(probes[row.key].probes || []).slice(0, 6).map((p) => (
                <span key={p.url} className={"lf-mp " + (p.ok ? "ok" : "bad")}>
                  {p.ok ? "✓" : "✗"} {p.url.replace(/^https?:\/\//, "")}{p.ok && p.ms ? ` · ${p.ms}ms` : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="set-btnrow">
        <button className="set-btn2" disabled={busy} onClick={probe}><RefreshCw size={14} /> {busy ? "探活中…" : "探活镜像"}</button>
        <button className="set-btn2" onClick={save}><Save size={14} /> 保存镜像</button>
      </div>
    </div>
  );
}
