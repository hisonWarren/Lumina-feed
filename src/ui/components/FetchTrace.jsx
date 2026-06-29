// Fetch Trace · 取文过程透明抽屉（P2）
import React, { useState } from "react";
import { Loader, ChevronDown, Check, X, Minus } from "lucide-react";

const STATUS_ICON = {
  pending: null,
  running: <Loader size={12} className="ff-spin" />,
  ok: <Check size={12} />,
  fail: <X size={12} />,
  skip: <Minus size={12} />,
};

/** @param {{ steps?: Array<{ id: string; label: string; status: string; detail?: string; ms?: number }>; compact?: boolean }} props */
export default function FetchTrace({ steps, compact = false }) {
  const running = steps && steps.some((s) => s.status === "running");
  const okCount = steps ? steps.filter((s) => s.status === "ok").length : 0;
  const failCount = steps ? steps.filter((s) => s.status === "fail").length : 0;
  const successIdle = steps && steps.length && !running && okCount > 0;
  const [open, setOpen] = useState(() => !(compact && successIdle));
  if (!steps || !steps.length) return null;

  return (
    <div className="lf-fetch-trace">
      <button type="button" className="lf-ft-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {running ? <Loader size={13} className="ff-spin" /> : null}
        <span>{running ? "正在获取全文…" : failCount && !okCount ? "取文未成功" : okCount ? (successIdle && compact ? "全文已就绪" : "取文过程") : "准备取文"}</span>
        <span className="lf-ft-meta">{okCount ? `${okCount} 步成功` : ""}{failCount ? `${failCount} 步失败` : ""}</span>
        <ChevronDown size={13} className={"lf-ft-caret" + (open ? " open" : "")} />
      </button>
      {open && (
        <ul className="lf-ft-steps">
          {steps.map((s) => (
            <li key={s.id} className={"lf-ft-step " + s.status}>
              <span className="ico">{STATUS_ICON[s.status] || STATUS_ICON.pending}</span>
              <span className="lbl">{s.label}</span>
              {s.detail ? <span className="det">{s.detail}</span> : null}
              {s.ms != null && s.ms > 0 ? <span className="ms">{s.ms}ms</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
