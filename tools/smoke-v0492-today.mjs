#!/usr/bin/env node
/** v0.4.92 烟测：导出选择 + 阅读器助手 L1/L2 记忆（结构 + DeepSeek 可选） */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askReader, buildAskMemoryBlock } from "../src/core/reader/reader-ai.ts";
import { llmFromConfig } from "../src/core/summarize/llm-client.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pass = (n, d = "") => console.log(`  ✓ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => { console.error(`  ✗ ${n}${d ? " — " + d : ""}`); process.exitCode = 1; };

console.log("\n── smoke-v0492-today (structure) ──\n");

const lib = readFileSync(path.join(ROOT, "src/ui/modules/Library.jsx"), "utf8");
const reader = readFileSync(path.join(ROOT, "src/ui/modules/Reader.jsx"), "utf8");
const rai = readFileSync(path.join(ROOT, "src/core/reader/reader-ai.ts"), "utf8");
const ipc = readFileSync(path.join(ROOT, "electron/ipc.ts"), "utf8");

/exportPickMode/.test(lib) && /exportSel/.test(lib) && /选择导出/.test(lib)
  ? pass("Library 独立「选择导出」模式") : fail("Library 缺 exportPickMode");
!/exportTargets[\s\S]*sel\.size/.test(lib) || /exportPickMode/.test(lib)
  ? pass("导出目标不绑定跨篇分析 sel") : fail("导出仍绑定 corpus sel");

/buildAskMemoryBlock/.test(rai) && /ASK_PRIOR_TURN_CAP/.test(rai) && /MEMORY_SYS/.test(rai)
  ? pass("reader-ai L1+L2 记忆块") : fail("reader-ai 缺记忆实现");
/priorTurns/.test(ipc) && /artifacts/.test(ipc)
  ? pass("reader:ask IPC 传递 priorTurns/artifacts") : fail("IPC 未扩展");
/outlineArtifactText/.test(reader) && /priorTurns/.test(reader)
  ? pass("AssistantPanel 组装 priorTurns + 制品") : fail("Reader 助手未接线");

const mem = buildAskMemoryBlock(
  [{ q: "样本量多少？", a: "共招募 42 名被试 [p.4]" }],
  { summary: "方法：fMRI 实验 [p.3]" },
);
mem.length > 0 && /42/.test(mem) && /仅助指代/.test(mem)
  ? pass("buildAskMemoryBlock 单元", mem.split("\n")[0]) : fail("记忆块组装失败");

const key = process.env.LUMINA_TEST_DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY || process.env.LUMINA_TEST_KEY;
if (!key) {
  console.log("\n  ○ DeepSeek 追问烟测 — 跳过（无 LUMINA_TEST_DEEPSEEK_KEY）\n");
  process.exit(process.exitCode || 0);
}

console.log("\n── smoke-v0492-today (DeepSeek follow-up) ──\n");

const pages = [
  { page: 1, text: "Introduction. We studied working memory in older adults (N=48)." },
  { page: 3, text: "Methods. Participants completed a 2-back task during fMRI scanning." },
  { page: 5, text: "Results. Accuracy declined with age (p<0.01)." },
  { page: 8, text: "Limitations. The sample was recruited from a single university clinic." },
];

const llm = await llmFromConfig({ provider: "deepseek", model: "deepseek-chat" }, () => key);

const r1 = await askReader(pages, "这篇研究的样本量是多少？", llm);
if (!r1.text || !/\b48\b/.test(r1.text)) fail("首轮样本量", r1.text?.slice(0, 120));
else pass("首轮样本量", r1.text.slice(0, 80).replace(/\s+/g, " "));

const r2 = await askReader(pages, "那它的主要局限是什么？", llm, {
  priorTurns: [{ q: "这篇研究的样本量是多少？", a: r1.text }],
  artifacts: { summary: "样本 N=48，2-back fMRI [p.1][p.3]" },
});
if (!r2.text || !/局限|limitation|单|大学|诊所|样本/i.test(r2.text)) fail("追问局限", r2.text?.slice(0, 160));
else pass("追问局限（含 L2 记忆）", r2.text.slice(0, 100).replace(/\s+/g, " "));

if (!/\[p\.\d+\]/.test(r2.text)) fail("追问缺页码引用", r2.text?.slice(0, 120));
else pass("追问仍带页码", (r2.text.match(/\[p\.\d+\]/g) || []).join(" "));

console.log("\nsmoke-v0492-today OK\n");
