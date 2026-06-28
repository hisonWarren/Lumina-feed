#!/usr/bin/env node
// 结构验证：reader_nav_find（Acrobat 式导航侧栏 + 跳页 / 检索语法可发现性 + 年份约束 + 结果排序）。
// 构建于 provider_translate 之上（Reader 为超集）。仅结构级——侧栏手感/调宽/检索真返回/排序观感须真机。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);
function balanced(src) {
  if (typeof src !== "string") return false;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
  s = s.replace(/\/\/[^\n]*/g, " ");
  const pairs = { "}": "{", ")": "(", "]": "[" }, open = new Set(["{", "(", "["]), st = [];
  for (const ch of s) { if (open.has(ch)) st.push(ch); else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; } }
  return st.length === 0;
}

const reader = read("src/ui/modules/Reader.jsx");
const ff = read("src/ui/modules/FindFetch.jsx");

console.log("\n[1] Reader.jsx · Acrobat 式导航侧栏");
ok(has(reader, ".rd-rail{") && has(reader, ".rd-railbtn"), "图标轨 CSS .rd-rail/.rd-railbtn");
ok(has(reader, ".rd-sidepanel{"), "可展开面板 .rd-sidepanel");
ok(has(reader, ".rd-resize{") && has(reader, "cursor:col-resize"), "调宽手柄 .rd-resize（col-resize）");
ok(has(reader, "const [sidePanel, setSidePanel]"), "sidePanel 状态");
ok(has(reader, "const startResize = useCallback"), "startResize 调宽处理");
ok(has(reader, '<div className="rd-rail">'), "图标轨 JSX");
ok(has(reader, '<Images size={17} />') && has(reader, '<List size={17} />') && has(reader, '<Bookmark size={17} />'), "三面板图标 缩略图/目录/书签");
ok(has(reader, 'setSidePanel(null)') && has(reader, "收起面板"), "单面板关闭按钮");
ok(has(reader, 'style={{ width: sideWidth }}'), "面板宽度受控（可调）");
ok(reader && reader.indexOf("sideTab") === -1, "旧 sideTab 已彻底移除");

console.log("\n[2] Reader.jsx · 页面书签（会话级导航）");
ok(has(reader, "const [navmarks, setNavmarks]"), "navmarks 状态");
ok(has(reader, "const addMark = useCallback") && has(reader, "const removeMark = useCallback"), "addMark / removeMark");
ok(has(reader, ".rd-marks{") && has(reader, ".rd-mark-add"), "书签列表 CSS");
ok(has(reader, "收藏当前页"), "收藏当前页");
ok(has(reader, "rd-marks-empty"), "书签空态指路");

console.log("\n[3] Reader.jsx · 跳页输入（回车/失焦提交）");
ok(has(reader, "const [pageInput, setPageInput]"), "pageInput 受控");
ok(has(reader, 'if (e.key === "Enter")') && has(reader, "e.currentTarget.blur()"), "回车提交跳页");
ok(has(reader, "onBlur={() =>") && has(reader, "setPageInput(String(page))"), "失焦提交/复位");

console.log("\n[4] 组合性：provider_translate 的 Reader 改动仍在（超集）");
ok(has(reader, ".rd-trwrap") && has(reader, '<span className="rd-trwrap">'), "译菜单定位修复保留");
ok(has(reader, "const pmapRef = useRef({})") && has(reader, "bridge.saveTranslation"), "翻译持久缓存保留");

console.log("\n[5] FindFetch.jsx · 检索语法可发现性 + 年份约束（B2）");
ok(has(ff, "检索语法") && has(ff, "ff-sx-pop"), "检索语法帮助气泡");
ok(has(ff, "[tiab]") && has(ff, "[au]") && has(ff, "AND"), "字段标签/布尔示例");
ok(has(ff, "filters.yearFrom") && has(ff, "filters.yearTo"), "年份 → filters（走引擎，已转发）");
ok(has(ff, 'className="ff-year"') && has(ff, "发表年份"), "年份约束面板");
ok(has(ff, "非数据库分面") && has(ff, "我的文献"), "诚实框定：非分面 + 富筛选归我的文献（守范围）");

console.log("\n[6] FindFetch.jsx · 结果排序（C1，呈现层重排，非收窄）");
ok(has(ff, "function sortResults"), "sortResults 客户端重排");
ok(has(ff, "const shown = useMemo") && (has(ff, "pageItems.map") || has(ff, "shown.map((p)")), "shown 排序后渲染（pageItems 分页）");
ok(has(ff, '"newest"') && has(ff, '"oldest"') && has(ff, '"title"') && has(ff, '"author"'), "四种排序 最新/最早/标题/作者");
ok(has(ff, "呈现层重排") && (has(ff, "非分面") || has(ff, "非数据库分面")), "注释明确：重排非收窄（守范围）");
ok(has(ff, "FF_CSS") && has(ff, "<style>{FF_CSS}</style>"), "组件内 <style>（不动 LuminaApp）");

console.log("\n[7] 括号平衡");
ok(balanced(reader), "Reader.jsx 平衡");
ok(typeof ff === "string" && ff.includes("export default"), "FindFetch.jsx 存在（JSX 语法由 esbuild 构建验证）");

console.log("\n──────────────────────────────");
console.log(`reader_nav_find 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：图标轨展开/收起·拖拽调宽·窄窗 / 书签跳转 / 跳页回车 / 检索语法真生效·年份过滤真返回 / 排序在真实 ~30 条 / 6 主题");
process.exit(fail ? 1 : 0);
