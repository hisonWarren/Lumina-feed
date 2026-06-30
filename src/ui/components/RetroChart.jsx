// 回顾图表 · 确定性 SVG（无图表库 / 无 Hook，纯 props→SVG）
// 设计：单一 petrol 色阶经 color-mix 派生（不写死 hex）；响应式 viewBox（禁固定像素宽）；
//       native <title> 悬停提示（不引入状态）。两图都「关于你的 feed」，标题/图注由调用方加诚实横幅。
import React from "react";

// 单色阶：petrol 由强到弱 + 中性「其他」。返回 CSS 颜色串（走变量，组件内无裸 hex）。
function rampColor(i, n) {
  if (n <= 1) return "var(--petrol)";
  const pct = Math.round(88 - (66 * i) / Math.max(1, n - 1)); // 88%→22%
  return `color-mix(in srgb, var(--petrol) ${pct}%, var(--surf))`;
}
const OTHER_COLOR = "color-mix(in srgb, var(--ink4) 36%, var(--surf))";

function niceMax(v) {
  if (v <= 5) return Math.max(1, v);
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * pow;
}

// ── feed 体量：面积 + 折线 ──
export function RetroVolumeChart({ buckets }) {
  const data = Array.isArray(buckets) ? buckets : [];
  if (data.length === 0) {
    return <div className="rt-chart-empty">暂无可视化数据</div>;
  }
  const W = 720, H = 220, padL = 38, padR = 14, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxY = niceMax(Math.max(1, ...data.map((d) => d.count)));
  const n = data.length;
  const x = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v) => padT + innerH - (innerH * v) / maxY;
  const pts = data.map((d, i) => [x(i), y(d.count)]);
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = `M${x(0).toFixed(1)} ${(padT + innerH).toFixed(1)} ` +
    pts.map((p) => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") +
    ` L${x(n - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
  const ticks = 4;
  const labelEvery = Math.ceil(n / 8);

  return (
    <svg className="rt-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="你的订阅每段时间收到的论文数">
      {Array.from({ length: ticks + 1 }, (_, t) => {
        const v = (maxY * t) / ticks;
        const yy = y(v);
        return (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 6} y={yy + 3} textAnchor="end" className="rt-axis-lbl">{Math.round(v)}</text>
          </g>
        );
      })}
      <path d={area} fill="var(--petrol-tint)" stroke="none" />
      <path d={line} fill="none" stroke="var(--petrol)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3" fill="var(--petrol)" />
          <title>{data[i].label}：{data[i].count} 篇（进入你的 feed）</title>
        </g>
      ))}
      {data.map((d, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="rt-axis-lbl">{d.label}</text>
        ) : null,
      )}
    </svg>
  );
}

// ── 主题构成：堆叠柱（每桶 top-N 主题 + 其他） ──
export function RetroTopicChart({ topicSeries }) {
  const ts = topicSeries && Array.isArray(topicSeries.buckets) ? topicSeries : { topics: [], buckets: [] };
  if (ts.buckets.length === 0 || ts.topics.length === 0) {
    return <div className="rt-chart-empty">该范围内主题信息不足以作构成图（论文缺关键词/类型标注）</div>;
  }
  const topics = ts.topics, buckets = ts.buckets;
  const W = 720, H = 240, padL = 30, padR = 14, padT = 14, padB = 34;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const totals = buckets.map((b) => b.counts.reduce((a, c) => a + c, 0) + b.other);
  const maxTotal = niceMax(Math.max(1, ...totals));
  const n = buckets.length;
  const gap = 6;
  const bw = Math.max(4, (innerW - gap * (n - 1)) / n);
  const labelEvery = Math.ceil(n / 8);

  return (
    <svg className="rt-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="你的订阅主题构成随时间">
      {Array.from({ length: 5 }, (_, t) => {
        const yy = padT + (innerH * t) / 4;
        return <line key={t} x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--line)" strokeWidth="1" />;
      })}
      {buckets.map((b, bi) => {
        const xb = padL + bi * (bw + gap);
        let acc = 0;
        const segs = [];
        b.counts.forEach((c, ti) => {
          if (c <= 0) return;
          const h = (innerH * c) / maxTotal;
          const yTop = padT + innerH - (innerH * (acc + c)) / maxTotal;
          segs.push(
            <g key={ti}>
              <rect x={xb} y={yTop} width={bw} height={Math.max(0.5, h)} fill={rampColor(ti, topics.length)} rx="1.5">
                <title>{b.label} · {topics[ti]}：{c} 篇</title>
              </rect>
            </g>,
          );
          acc += c;
        });
        if (b.other > 0) {
          const h = (innerH * b.other) / maxTotal;
          const yTop = padT + innerH - (innerH * (acc + b.other)) / maxTotal;
          segs.push(
            <rect key="other" x={xb} y={yTop} width={bw} height={Math.max(0.5, h)} fill={OTHER_COLOR} rx="1.5">
              <title>{b.label} · 其他：{b.other} 篇</title>
            </rect>,
          );
        }
        return (
          <g key={bi}>
            {segs}
            {(bi % labelEvery === 0 || bi === n - 1) && (
              <text x={xb + bw / 2} y={H - 12} textAnchor="middle" className="rt-axis-lbl">{b.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// 图例（纯展示）
export function RetroTopicLegend({ topicSeries }) {
  const ts = topicSeries || { topics: [] };
  if (!ts.topics || ts.topics.length === 0) return null;
  return (
    <div className="rt-legend">
      {ts.topics.map((t, i) => (
        <span key={i} className="rt-legend-item">
          <span className="rt-legend-dot" style={{ background: rampColor(i, ts.topics.length) }} />
          {t}
        </span>
      ))}
      <span className="rt-legend-item">
        <span className="rt-legend-dot" style={{ background: OTHER_COLOR }} />其他
      </span>
    </div>
  );
}
