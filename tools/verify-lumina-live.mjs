#!/usr/bin/env node
// synra_patch_lumina_live · verify
//   node tools/verify-lumina-live.mjs <target>   （默认 .）
// 对已应用目标做结构断言：UI↔真实引擎接线 + ipc/preload 扩展 + 红线保持 + UX 不回归。
// React/JSX 无法在无 npm 沙箱执行，且真实端到端需 Electron+网络+LLM key →
// 这里仅断言「接线存在且正确」，端到端能力在用户机器验收（见 EXIT_CRITERIA 第三层）。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const T = process.argv[2] || ".";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };
const read = (p) => { try { return readFileSync(join(T, p), "utf8"); } catch { return ""; } };
const has = (s, ...x) => x.every((q) => s.includes(q));

const bridge = read("src/ui/lumina-bridge.js");
const obs = read("src/ui/Observatory.jsx");
const ux = read("src/ui/lumina-ux.jsx");
const ipc = read("electron/ipc.ts");
const preload = read("electron/preload.ts");
const main = read("electron/main.ts");

// ───────── 桥接层 ─────────
console.log("— 桥接层 lumina-bridge.js —");
ok(bridge && has(bridge, "export const hasBackend", "export const bridge"), "导出 hasBackend + bridge");
ok(has(bridge, "window.luminaApi"), "桥封装 window.luminaApi");
ok(has(bridge, "window.luminaOa"), "桥封装 window.luminaOa");
ok(has(bridge, "export function toCardModel"), "真实 Paper→UI 卡片适配器");
ok(has(bridge, "export function toCoreSub") && has(bridge, "export function fromCoreSub"), "UI 订阅↔核心 Subscription 适配器");
ok(has(bridge, "export function digestItemToCard"), "DigestItem→卡片适配器");
ok(has(bridge, "api.searchOnline", "api.summarizePaper", "api.subsList", "api.subsSave"), "桥调用真实 luminaApi 方法");
ok(has(bridge, "oa.fetchPdf") && has(bridge, "oa.resolve"), "桥调用真实 OA 解析+抓取");

// ───────── 引擎侧扩展(ipc/preload) ─────────
console.log("— 引擎侧扩展 —");
ok(has(ipc, "papers: agg.papers"), "ipc search:online 同时返回 papers");
ok(has(ipc, '"oa:resolve"') && has(ipc, "resolveOa"), "ipc 新增 oa:resolve（真实 OA 解析，deny-gated）");
ok(has(ipc, 'from "../src/core/oa/oa-resolver.ts"'), "ipc 引入真实 OA 解析器");
ok(has(preload, "luminaOa") && has(preload, "resolve:"), "preload 暴露 luminaOa.resolve");

// ───────── UI 接线（mock → 真引擎，带 hasBackend 分支） ─────────
console.log("— UI 接线 —");
ok(has(obs, 'from "./lumina-bridge.js"') && has(obs, "const live = hasBackend()"), "Observatory 引入桥并判 live");
ok(has(obs, "const [papers, setPapers] = useState(PAPERS)"), "结果由 papers 状态驱动(mock 仅作回退初值)");
ok(has(obs, "papers.filter(") && !has(obs, "PAPERS.filter((p) => {\n    if (q"), "facet 过滤改用 papers 状态");
ok(has(obs, "bridge.searchOnline(q, filters)"), "在线检索接 bridge.searchOnline");
ok(has(obs, "const [loading, setLoading]") && has(obs, "检索中…"), "检索 loading 态");
ok(has(obs, "const [searchErr, setSearchErr]") && has(obs, "检索出错"), "检索 error 态");
ok(has(obs, "bridge.fetchFullText(p)"), "获取全文接真实 OA 抓取");
ok(has(obs, "bridge.setState(id"), "收藏/筛选状态落库(setState)");
ok(has(obs, "bridge.subsSave(s)") && has(obs, "bridge.subsRemove(id)"), "订阅增删落库(subsSave/Remove)");
ok(has(obs, "bridge.subsList()"), "启动载入真实订阅");
ok(has(obs, "bridge.summarize(p.id, o)"), "抽屉总结接真实 summarizeGrounded");
ok(has(obs, "bridge.subsRunNow(sub.id)") && has(obs, "digestItemToCard"), "今日推送接真实 digest");
ok(has(obs, "bridge.exportPapers"), "导出接真实 exporter");
ok(has(obs, "bridge.onDigest"), "监听后台每日推送结果");

// ───────── 设置面板(LLM 配置，让总结真正可用) ─────────
console.log("— 设置面板 —");
ok(has(ux, "export function SettingsPanel"), "设置面板组件存在");
ok(has(ux, "api.saveSettings") && has(ux, "api.setSecret"), "设置经 saveSettings + setSecret(钥匙串)");
ok(has(obs, "<SettingsPanel"), "Observatory 挂载设置面板");

// ───────── 红线保持(接线不得破红线) ─────────
console.log("— 红线保持 —");
ok(has(obs, "AI 不裁判") || has(obs, "纳入/排除永远人工"), "AI 不替做纳入/排除(screening 仅人工)");
ok(has(bridge, "resolve") && has(bridge, "fetchPdf") && !has(bridge, "scihub") && !has(bridge, "libgen"), "取全文仅走合法 OA 解析(无影子库)");
ok(has(ux, "钥匙串") || has(ux, "setSecret"), "密钥走钥匙串，不落明文");

// ───────── UX 不回归(取代 synra_patch_lumina_ux) ─────────
console.log("— UX 不回归(supersede UX 包) —");
ok(has(obs, "useState(DEFAULT_THEME)") && has(obs, "data-theme={themeId}"), "默认亮色 + 多主题仍在");
ok(has(main, "frame: false") && has(main, "Menu.setApplicationMenu(null)"), "无边框 + 去原生菜单仍在");
ok(has(obs, "<TitleBar") && has(obs, "<SubscriptionManager") && has(obs, "lf-act-ft"), "标题栏/订阅管理/取全文主操作仍在");

// ───────── UX-F 交互流畅性 ─────────
console.log("— UX-F —");
ok(has(obs, 'pushToast("订阅已保存"') && has(obs, "已获取合法 OA 全文"), "F1 双反馈:写操作有 toast");
ok(has(obs, "awaiting") && has(obs, "生成中…"), "F1 双反馈:总结有 awaiting/生成中态");
ok(has(obs, "g?.error") && has(obs, "lf-noresult"), "F2 非静默:错误/空态有提示");

// ───────── 文档项 ─────────
console.log("— 文档项 —");
const reP = join(HERE, "..", "00_analysis", "ROLE_EVALUATION.md");
const re = existsSync(reP) ? readFileSync(reP, "utf8") : "";
ok(re && has(re, "契约对接") , "ROLE_EVALUATION 含「契约对接表」");
ok(re && has(re, "Pre-mortem") && (has(re, "端到端") || has(re, "验收")), "ROLE_EVALUATION 含 Pre-mortem + 端到端验收");
ok(re && has(re, "保留异议"), "ROLE_EVALUATION 含保留异议");

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
