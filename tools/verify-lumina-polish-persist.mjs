#!/usr/bin/env node
// 结构验证：polish_persist（书签持久化 navmark:<docKey> + 全局 reduced-motion 兜底 + 语法气泡窄窗自适应）。
// 构建于 provider_translate + reader_nav_find 之上。仅结构级——持久化跨重开、reduced-motion 观感、窄窗须真机。
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
function jsxSyntaxCheck(p){try{execSync(`node tools/jsx-syntax-check.mjs ${p}`,{stdio:"pipe",cwd:process.cwd()});return true;}catch{return false;}}
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);
function balancedJs(src) {
  if (typeof src !== "string") return false;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
  s = s.replace(/\/\/[^\n]*/g, " ");
  const pairs = { "}": "{", ")": "(", "]": "[" }, open = new Set(["{", "(", "["]), st = [];
  for (const ch of s) { if (open.has(ch)) st.push(ch); else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; } }
  return st.length === 0;
}

const ipc = read("electron/ipc.ts");
const preload = read("electron/preload.ts");
const bridge = read("src/ui/lumina-bridge.js");
const reader = read("src/ui/modules/Reader.jsx");
const ff = read("src/ui/modules/FindFetch.jsx");
const app = read("src/ui/LuminaApp.jsx");

console.log("\n[1] 书签持久化 · 后端（navmark:<docKey> → number[]）");
ok(has(ipc, '"navmarks:get"') && has(ipc, '"navmarks:save"'), "ipc navmarks:get/save 处理器");
ok(has(ipc, '"navmark:" + docKey'), "ipc 键 navmark:<docKey>");
ok(has(ipc, "new Set(") && has(ipc, ".sort((a, b) => a - b)") && has(ipc, ".slice(0, 200)"), "ipc 去重+升序+上限200");
ok(has(ipc, "Array.isArray(a) ? a : []"), "ipc get 兜底数组");
ok(has(preload, 'getNavmarks:') && has(preload, 'saveNavmarks:') && has(preload, '"navmarks:get"') && has(preload, '"navmarks:save"'), "preload 暴露 get/saveNavmarks");
ok(has(bridge, "async getNavmarks(docKey)") && has(bridge, "async saveNavmarks(docKey, pages)"), "bridge get/saveNavmarks");
ok(has(bridge, "!r.getNavmarks") && has(bridge, "return [];") && has(bridge, "!r.saveNavmarks"), "bridge 防御式回落（无后端 []/false）");

console.log("\n[2] 书签持久化 · Reader 接线");
ok(has(reader, "bridge.getNavmarks(docKey).then"), "打开时按 docKey 加载书签");
ok(has(reader, "bridge.saveNavmarks(docKey, next)"), "增/删后落库");
ok(reader && (reader.match(/bridge\.saveNavmarks\(docKey, next\)/g) || []).length === 2, "addMark + removeMark 均落库（2 处）");
ok(has(reader, "持久化导航"), "状态注释更新为持久化");

console.log("\n[3] 全局 reduced-motion 兜底（a11y）");
ok(has(app, "@media (prefers-reduced-motion: reduce){ *,*::before,*::after{"), "LuminaApp 全局 reduced-motion");
ok(has(app, "transition-duration:.01ms !important") && has(app, "animation-duration:.01ms !important"), "动画/过渡时长归零");

console.log("\n[4] 语法气泡窄窗自适应");
ok(/\.ff-sx-pop\{[^}]*width:min\(/.test(read("src/ui/modules/FindFetch.jsx"))||/max-width:/.test(read("src/ui/modules/FindFetch.jsx")), "ff-sx-pop 窄窗防溢出");

console.log("\n[5] 链路完整性（前置补丁未回退）");
ok(has(ipc, '"llm:listModels"') && has(ipc, '"translations:get"'), "provider_translate 后端仍在（listModels/translations）");
ok(has(reader, ".rd-trwrap") && has(reader, "pmapRef"), "provider_translate Reader 仍在（译菜单/缓存）");
ok(has(reader, ".rd-rail") && has(reader, "sidePanel") && has(reader, "startResize"), "reader_nav_find 侧栏仍在");
ok(has(ff, "function sortResults") && (has(ff, "pageItems.map") || has(ff, "shown.map")), "reader_nav_find 排序仍在（pageItems 分页渲染）");

console.log("\n[7] 检索会话 keep-alive + localStorage 恢复");
ok(has(read("src/ui/find-fetch-session.js"), "saveFindFetchSession") && has(read("src/ui/find-fetch-session.js"), "loadFindFetchSession"), "find-fetch-session 模块");
ok(has(ff, "loadFindFetchSession") && has(ff, "applySnapshot") && has(ff, "ff-session-bar"), "FindFetch 会话恢复 + 会话条");
ok(has(app, "lf-pane") && has(app, "is-hidden") && has(app, "onSessionChange"), "LuminaApp keep-alive 检索面板");

console.log("\n[6] 括号平衡（JS/JSX）");
ok(balancedJs(bridge), "lumina-bridge.js 平衡");
ok(balancedJs(reader), "Reader.jsx 平衡");
ok(typeof ff === "string" && ff.includes("export default"), "FindFetch.jsx 存在（JSX 语法由 esbuild 构建验证）");
ok(jsxSyntaxCheck("src/ui/LuminaApp.jsx"), "LuminaApp.jsx 语法（jsx-syntax-check）");

console.log("\n──────────────────────────────");
console.log(`polish_persist 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：书签重开 PDF 后仍在·按 docKey 隔离 / reduced-motion 系统开关下不动 / 语法气泡窄窗不溢出 / 6 主题");
process.exit(fail ? 1 : 0);
