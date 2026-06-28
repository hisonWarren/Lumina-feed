#!/usr/bin/env node
// 结构验证：reader_plus_graph（阅读理解可视化）= 结构图(Layer1·确定性渲染已接地 outline) + 逻辑流程图(Layer2·新 flowmap 分析器，引擎产 JSON→前端确定性 DAG)。
// 叠加于 reader_plus 全链（P1–P8 + polish）之上。仅结构级——图质量/布局/点击跳页/SVG 导出/真实 LLM 须真机。
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

const rp = read("src/core/reader/reader-plus.ts");
const br = read("src/ui/lumina-bridge.js");
const rd = read("src/ui/modules/Reader.jsx");

console.log("\n[1] 引擎 reader-plus.ts · 信封契约 + flowmap 分析器");
ok(has(rp, "graph?:") && has(rp, "nodes:") && has(rp, "edges:") && has(rp, "pageRefs: number[]"),
  "AnalysisEnvelope 增 graph 字段（nodes{id,label,pageRefs} + edges{from,to,label?}）");
ok(/flowmap:\s*\{[^}]*lane:\s*"inference"/.test(rp), "flowmap 登记 KIND_REGISTRY 且 lane=inference（HC-1 单一车道真相源）");
ok(/flowmap:\s*\{[^}]*groundability:\s*"L2"/.test(rp), "flowmap groundability=L2（推断车道）");
ok(has(rp, "无页码依据的节点已标灰"), "flowmap framing 明示无页码节点标灰（暴露而非静默删）");
ok(has(rp, "PROMPTS") && /flowmap:\s*"[^"]*nodes/.test(rp) && has(rp, "不要把相关关系画成因果"), "flowmap prompt：产 nodes+edges JSON、只画正文写明环节、不补未述步骤、不把相关画成因果");
ok(has(rp, "async function runFlowmap"), "runFlowmap 实现");
ok(has(rp, "valid.has(x)") && has(rp, "pages.map((p) => p.page)"), "节点 pageRefs 经真实页码集过滤");
ok(has(rp, "ids.has(e.from) && ids.has(e.to)"), "引用不存在节点的边被丢弃");
ok(has(rp, "graph: { nodes, edges }") && has(rp, 'sourceBasis: "fulltext"'), "runFlowmap 返回 graph 信封（sourceBasis=fulltext）");
ok(has(rp, 'if (kind === "flowmap") return runFlowmap'), "analyzeReader 派发 flowmap");
ok(has(rp, "绝不让模型直接画 SVG"), "红线注释：模型只产 JSON、不画 SVG（防幻觉黑箱）");

console.log("\n[2] 引擎 lumina-bridge.js · 无后端 mock 信封");
ok(has(br, 'if (kind === "flowmap")') && has(br, "graph:"), "flowmap mock 信封含 graph");
ok(/flowmap[\s\S]{0,600}pageRefs:\s*\[\]/.test(br), "mock 含一个无页码节点（演示标灰）");
ok(/flowmap[\s\S]{0,600}原型模拟/.test(br), "mock 标「原型模拟」不伪造接地");

console.log("\n[3] 渲染 Reader.jsx · 可视化组件 + 路由");
ok(has(rd, "function StructureMap("), "StructureMap（结构图）组件");
ok(has(rd, "function FlowGraph("), "FlowGraph（流程图 SVG）组件");
ok(has(rd, "function GraphCard("), "GraphCard（图解卡）组件");
ok(has(rd, "function layoutGraph("), "layoutGraph 确定性分层布局");
ok(has(rd, "if (rank[b] < rank[a] + 1)"), "最长路径排秩（环安全：有界迭代）");
ok(has(rd, "if (env.graph) return <GraphCard"), "EnvelopeCard 据 env.graph 路由到 GraphCard");
ok(rd && rd.indexOf("if (env.graph)") > rd.indexOf("if (!env) return null;"), "graph 路由在 null 守卫之后");
ok(has(rd, "const STAGE_COLORS") && has(rd, "function stageColor("), "结构图阶段着色 STAGE_COLORS/stageColor");

console.log("\n[4] 渲染 · 接地 / 跳页 / 导出（红线落到交互）");
ok(has(rd, 'grounded ? "" : " ng"') || has(rd, '(grounded ? "" : " ng")'), "无页码节点加 .ng 类（标灰）");
ok(has(rd, "grounded && onGoto && onGoto(n.pageRefs[0])"), "有页码节点点击跳首个页码");
ok(has(rd, "无页码依据，请谨慎"), "无页码节点 tooltip 明示「请谨慎」");
ok(has(rd, "onGoto && onGoto(p)") && has(rd, "rd-spages"), "结构图页码 pill 可点击跳页");
ok(has(rd, "new XMLSerializer()") && has(rd, "导出 SVG"), "GraphCard 导出 SVG（确定性序列化）");
ok(has(rd, 'env.lane === "inference"') && has(rd, "推断车道 · AI 解读，非原文事实"), "GraphCard 车道标签据 env.lane（HC-1，含推断车道文案）");

console.log("\n[5] 渲染 · 集成入口（助手大纲切换 + 推读流程图按钮）");
ok(has(rd, "const [outlineView, setOutlineView]"), "AssistantPanel outlineView 状态");
ok(has(rd, 'className="rd-vtoggle"') && has(rd, "结构图") && has(rd, "列表"), "大纲区 结构图/列表 切换");
ok(has(rd, "<StructureMap env={outlineEnv}"), "切换渲染 StructureMap（结构图）");
ok(has(rd, "outlineEnv.refused") && has(rd, "<EnvelopeCard env={outlineEnv}"), "outline 被拒时回退 EnvelopeCard（不强塞结构图）");
ok(has(rd, "function FlowmapTool("), "FlowmapTool（流程图生成）组件");
ok(has(rd, '<FlowmapTool ensurePages={ensurePages}'), "InferencePane 渲染 FlowmapTool");
ok(/FlowmapTool[\s\S]{0,400}readerAnalyze\("flowmap"/.test(rd), "FlowmapTool 调 readerAnalyze('flowmap')");
ok(/FlowmapTool[\s\S]{0,500}readerAnalysisSave/.test(rd), "FlowmapTool 结果缓存 readerAnalysisSave");

console.log("\n[6] 图标 / CSS / 平衡");
ok(/import \{[^}]*\bWorkflow\b[^}]*\bMap\b[^}]*\} from "lucide-react"/.test(rd), "Workflow / Map 图标已导入");
ok(rd && rd.indexOf("new Map(") === -1, "未使用 new Map()（避免与 lucide Map 导入冲突）");
ok(has(rd, ".rd-smap{") && has(rd, ".rd-snode{") && has(rd, ".rd-stag{"), "结构图 CSS .rd-smap/.rd-snode/.rd-stag");
ok(has(rd, ".rd-graph") && has(rd, ".rd-gnode") && has(rd, ".rd-gnode.ng") || has(rd, ".ng "), "流程图 CSS .rd-graph/.rd-gnode（含标灰 .ng）");
ok(has(rd, ".rd-vtoggle{") && has(rd, ".rd-vtab{"), "视图切换 CSS .rd-vtoggle/.rd-vtab");
ok(has(rd, ".rd-gcard{") && has(rd, ".rd-gcard.inf{"), "图解卡 CSS .rd-gcard（推断车道变体）");
ok(has(rd, "--amber") && has(rd, "--amberLine"), "流程图复用既有琥珀车道 token");
ok(balanced(rd), "Reader.jsx 括号平衡");
ok(balanced(br), "lumina-bridge.js 括号平衡");

console.log("\n[7] 范围 / 红线守护");
ok(has(rd, "function FlowGraph") && !/dangerouslySetInnerHTML/.test(rd), "前端确定性渲染 SVG，无 dangerouslySetInnerHTML（不渲染模型产 HTML）");
ok(/single|单篇|这一篇|本文/.test(rp) || !/corpus_framing[\s\S]{0,40}graph/.test(rp), "流程图限单篇（不跨文档作图）");
ok(rp && !/role:\s*"system"[\s\S]{0,200}SVG/.test(rp), "prompt 不要求模型产 SVG/HTML");

console.log("\n──────────────────────────────");
console.log(`  reader_plus_graph：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
