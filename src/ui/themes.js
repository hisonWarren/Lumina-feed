// Lumina Feed · 主题注册表（patch: lumina_ux）
// 设计：复用现有 .lf(暗基底) / .lf.day(亮基底) 的全部表面规则，
// 每个主题只声明 base('day'|'night') + 品牌强调三色（--gold/--goldDim/--peri），
// 经 data-theme 覆盖。证据类型语义色(--t-*)保持稳定（颜色承载含义，不随主题乱变）。
// 默认 = 亮色「日光」。

export const THEMES = [
  { id: "daylight", name: "晴台", base: "day",   gold: "#0E7C6F", goldDim: "#0B5F55", peri: "#3E5C92", swatch: ["#F4F4F1", "#0E7C6F", "#3E5C92"] },
  { id: "paper",    name: "米白", base: "day",   gold: "#A85A38", goldDim: "#8C4A2E", peri: "#4E7150", swatch: ["#F6F4EE", "#A85A38", "#4E7150"] },
  { id: "ink",      name: "青墨", base: "day",   gold: "#2F4A8C", goldDim: "#263B70", peri: "#9A6B2E", swatch: ["#F0F1F2", "#2F4A8C", "#9A6B2E"] },
  { id: "observatory", name: "暖夜", base: "night", gold: "#F2C879", goldDim: "#C9A463", peri: "#8AA9E0", swatch: ["#0E121C", "#F2C879", "#8AA9E0"] },
  { id: "dusk",     name: "薄暮", base: "night", gold: "#E2A0C8", goldDim: "#C07FA8", peri: "#9D8AE0", swatch: ["#16121C", "#E2A0C8", "#9D8AE0"] },
  { id: "forest",   name: "松林", base: "night", gold: "#86D6A4", goldDim: "#5FB07F", peri: "#7FC0D6", swatch: ["#101A14", "#86D6A4", "#7FC0D6"] },
];

export const DEFAULT_THEME = "daylight"; // ← 默认亮色（修复「默认不是亮色」）

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
export const isLight = (id) => themeById(id).base === "day";

/** 生成每个主题的强调色覆盖 CSS（只覆盖品牌三色 + mark/选区，复用基底表面规则）。 */
export const THEME_CSS = THEMES.map((t) => {
  const dim = t.base === "night" ? 0.16 : 0.16;
  const base = `.lf[data-theme="${t.id}"]{--gold:${t.gold};--goldDim:${t.goldDim};--peri:${t.peri};--petrol:${t.gold};--petrol-deep:${t.goldDim}}
.lf[data-theme="${t.id}"] .lf-mark svg{color:${t.gold}}
.lf[data-theme="${t.id}"] mark{background:${hexA(t.gold, t.base === "night" ? 0.22 : 0.16)};color:${t.goldDim}}
.lf[data-theme="${t.id}"] ::selection{background:${hexA(t.gold, dim + 0.02)}}`;
  if (t.base !== "night") return base;
  const deep = t.swatch[0]; // 该主题深色基底 → 真暗色 surface（此前 night 主题误用 .lf 亮表面）
  return base + `
html:has(.lf[data-theme="${t.id}"]:not(.day)), body:has(.lf[data-theme="${t.id}"]:not(.day)){background:${deep}}
.lf[data-theme="${t.id}"]:not(.day){--surf:${deep};--surf2:color-mix(in srgb, ${deep} 85%, #fff);--raise:color-mix(in srgb, ${deep} 77%, #fff);--ink:#ECEEF3;--ink2:#BBC2CE;--ink3:#8A93A1;--ink4:#6E7785;--line:rgba(255,255,255,.11);--line2:rgba(255,255,255,.18);--shadow:0 1px 2px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.55);--shadow-lg:0 24px 60px rgba(0,0,0,.66),0 4px 12px rgba(0,0,0,.45);background:var(--surf2)}`;
}).join("\n");

// hex → rgba 字符串
function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
