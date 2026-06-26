// Lumina Feed · 主题注册表（patch: lumina_ux）
// 设计：复用现有 .lf(暗基底) / .lf.day(亮基底) 的全部表面规则，
// 每个主题只声明 base('day'|'night') + 品牌强调三色（--gold/--goldDim/--peri），
// 经 data-theme 覆盖。证据类型语义色(--t-*)保持稳定（颜色承载含义，不随主题乱变）。
// 默认 = 亮色「日光」。

export const THEMES = [
  { id: "daylight", name: "日光", base: "day",   gold: "#A86E22", goldDim: "#8C5C1C", peri: "#3C5DA4", swatch: ["#F4F2EB", "#A86E22", "#3C5DA4"] },
  { id: "paper",    name: "米白", base: "day",   gold: "#1E7F73", goldDim: "#15655B", peri: "#9A5B2A", swatch: ["#F6F4ED", "#1E7F73", "#9A5B2A"] },
  { id: "ink",      name: "青墨", base: "day",   gold: "#3F5CC0", goldDim: "#33489B", peri: "#B0792E", swatch: ["#F1F1F0", "#3F5CC0", "#B0792E"] },
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
  return `.lf[data-theme="${t.id}"]{--gold:${t.gold};--goldDim:${t.goldDim};--peri:${t.peri}}
.lf[data-theme="${t.id}"] .lf-mark svg{color:${t.gold}}
.lf[data-theme="${t.id}"] mark{background:${hexA(t.gold, t.base === "night" ? 0.22 : 0.16)};color:${t.goldDim}}
.lf[data-theme="${t.id}"] ::selection{background:${hexA(t.gold, dim + 0.02)}}`;
}).join("\n");

// hex → rgba 字符串
function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
