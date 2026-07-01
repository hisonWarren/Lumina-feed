#!/usr/bin/env node
// 结构验证：search_settings（设置模型框合并+API眼睛 · 检索字段下拉 · 渐进式检索 · 阅读首页左栏）。
// 构建于 packaging 全链之上。可结构验证；真机必验：模型框/切换观感、检索速度与到达顺序（沙箱无网络）、首页布局视觉。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, x) => typeof s === "string" && s.includes(x);
function balanced(src) {
  if (typeof src !== "string") return false;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/\/\/[^\n]*/g, " ");
  const pairs = { "}": "{", ")": "(", "]": "[" }, open = new Set(["{", "(", "["]), st = [];
  for (const ch of s) { if (open.has(ch)) st.push(ch); else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; } }
  return st.length === 0;
}
const set = read("src/ui/modules/Settings.jsx");
const ff = read("src/ui/modules/FindFetch.jsx");
const hub = read("src/ui/modules/ReadHub.jsx");
const agg = read("src/core/aggregate.ts");
const ipc = read("electron/ipc.ts");
const preload = read("electron/preload.ts");
const bridge = read("src/ui/lumina-bridge.js");

console.log("\n[1] 设置·模型单框可编辑 + API 眼睛（Q1/Q2）");
ok(has(set, ".set-combo-in{") && has(set, '<input className="set-combo-in set-mono"'), "模型框改为可编辑 input（点选或直接输入）");
ok(has(set, ".set-combo-tg{") && has(set, "set-combo-tg"), "下拉切换钮");
ok(!has(set, "showCustomInput &&"), "已删除第二个（自定义）输入框");
ok(!has(set, "自定义模型名"), "已删除「＋自定义模型名」菜单项（输入即自定义）");
ok(has(set, "const [showKey, setShowKey]") && has(set, "set-key-eye"), "API Key 显隐状态 + 眼睛按钮");
ok(has(set, 'type={showKey ? "text" : "password"}') && has(set, "EyeOff"), "眼睛切换 password/text");

console.log("\n[2] 检索·字段范围下拉（数据库式聚焦；非分面）");
ok(has(ff, "ff-field-wrap") && has(ff, "ff-field-opt") && has(ff, "FIELD_OPTS") && has(ff, "id: \"title\"") && has(ff, "id: \"mesh\""), "字段下拉含标题与主题词 MeSH");
ok(has(ff, 'const [field, setField]'), "field 状态");
ok(has(ff, 'field !== "all" && !isIdentifierLike(term) && !term.includes("[")') && has(ff, '(term + " [" + field + "]")'), "所选字段并入查询标签（DOI/已含标签不加）");
ok(has(ff, "ff-sx-pop") && has(ff, "ff-sx-ex") && has(ff, "AND"), "检索语法帮助分块展示布尔示例");

ok(has(read("src/core/querySpec.ts"), "FIELD_ALIAS") && has(read("src/core/querySpec.ts"), 'au: "author"'), "querySpec 字段别名（[ti]/[au]/[ab] 简写真正生效，消除无效标签）");

console.log("\n[3] 检索·渐进式（每源到达即显示，慢源不拖累首屏）");
ok(has(agg, "export async function aggregateSearchStream") && has(agg, "function postProcess("), "aggregate: aggregateSearchStream + 抽出 postProcess");
ok(has(agg, "export async function aggregateSearch("), "保留一次性 aggregateSearch（订阅等仍用）");
ok(has(ipc, 'ipcMain.handle("search:online-stream"') && has(ipc, 'e.sender.send("search:stream"'), "ipc: search:online-stream → search:stream 事件");
ok(has(ipc, "aggregateSearch, aggregateSearchStream"), "ipc 导入 aggregateSearchStream");
ok(has(preload, "searchOnlineStream:") && has(preload, 'ipcRenderer.on("search:stream"'), "preload: searchOnlineStream 监听");
ok(has(bridge, "searchOnlineStream(raw, filters, reqId, cb)") && has(bridge, "return null"), "bridge: searchOnlineStream（无支持返回 null → 回落）");
ok(has(ff, "bridge.searchOnlineStream(searchTerm, filters, reqId") && has(ff, "if (!streamed"), "FindFetch: 用流式 + 回落一次性");
ok(has(ff, "const curReq = useRef(0)") && has(ff, "ev.reqId !== curReq.current"), "竞态守卫（旧检索事件忽略）");
ok((has(ff, "ff-sources") || has(read("src/ui/components/HitSources.jsx"), "lf-sources")) && has(ff, "ff-more"), "每源进度条 + 底部「还在获取」");
ok(has(ff, "loading && results.length === 0 ?") && has(ff, "pageItems.map"), "渐进渲染：有结果即显（pageItems），loading 仅在无结果时占位");

console.log("\n[4] 阅读首页·历史列表（上下布局：主区在上、列表在下）");
ok(has(hub, ".rh-inner{") && /flex-direction:column/.test(hub), "rh-inner 上下布局（column）");
ok(has(hub, ".rh-main{") && has(hub, 'className="rh-main"') && has(hub, 'className="rh-rail"'), "主区 + 列表面板 rh-main + rh-rail");
ok(!has(hub, "order:-1"), "已移除左栏 order:-1（回归上下）");

console.log("\n[5] 链路完整性（前置未回退）");
ok(has(ff, "CitationActions") || (has(ff, "ff-cites") && has(ff, "copyCite")), "finish 结果页单条引用复制仍在（CitationActions 或内联 copyCite）");
ok(has(hub, "rhx-tabs") && has(hub, "MAX_TABS"), "multidoc 多标签仍在");
ok(has(set, "PROVIDERS") && has(set, "visionConsent"), "Settings 六提供方 + 云端读图开关仍在");
ok(has(ff, "ff-year-h") && (has(ff, "仅过滤本次") || has(ff, "非数据库分面") || has(ff, "我的文献")), "年份提示说明仅作用于本次结果");

console.log("\n[6] 括号平衡（JS/JSX；.ts 由 strip-types 校验）");
ok(balanced(set), "Settings.jsx 平衡");
ok(typeof ff === "string" && ff.includes("export default"), "FindFetch.jsx 存在（JSX 语法由 esbuild 构建验证）");
ok(balanced(hub), "ReadHub.jsx 平衡");
ok(balanced(bridge), "lumina-bridge.js 平衡");
ok(typeof agg === "string" && typeof ipc === "string" && typeof preload === "string", "aggregate/ipc/preload .ts 存在（语法见 strip-types）");

console.log("\n──────────────────────────────");
console.log(`search_settings 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：模型框点选/输入/切换观感 · API 眼睛 · 字段下拉检索 · 渐进式检索的速度与到达顺序（沙箱无网络，仅验结构）· 阅读首页左栏布局/窄屏回落视觉 · 6 主题");
process.exit(fail ? 1 : 0);
