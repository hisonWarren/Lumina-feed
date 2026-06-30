import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
console.log("── reader_plus_fix（阅读器 AI 面板 8 问修复）契约自检 ──");

// ───────── reader-ai.ts：总结 map-reduce（覆盖全篇 / 页码落到细节页），接地红线不破 ─────────
try { execSync("node --experimental-strip-types --check src/core/reader/reader-ai.ts", { stdio: "pipe" }); ok(true, "reader-ai.ts strip-types 通过"); }
catch { ok(false, "reader-ai.ts strip-types 通过"); }
const rai = R("src/core/reader/reader-ai.ts");
ok(/function composeSummaryText/.test(rai) && /chunkByPages\(/.test(rai) && /Promise\.all\(/.test(rai) && /function mapChunk/.test(rai),
  "总结改 map-reduce：分片抽要点（并发）→ 汇总，长文档不再只看首页");
const cap = /const ONE_PASS_CAP = (\d+)/.exec(rai);
ok(cap && Number(cap[1]) >= 16000, "总结单次取材上限提至 ≥16000（旧 12000 只够摘要页 → 引用全标 p.1 根因）");
ok(/MAP_SYS[\s\S]{0,400}\[p\.5\]|信息所在页码|信息在哪页/.test(rai), "map/reduce 指令强制「信息在哪页就标哪页」（不一律标 p.1）");
ok(/export async function summarizeReader[\s\S]{0,300}groundReaderAnswer/.test(rai), "summarizeReader 仍紧接 groundReaderAnswer 接地（BUG3 接线不破）");
ok(/summarizeReader[\s\S]{0,360}sourceBasis: "fulltext"/.test(rai), "总结仍带 sourceBasis:fulltext（红线④：AI 结论必带依据）");

// ───────── reader-plus.ts：截断救援 + 每 kind token 提额 + 取材范围 + 硬失败可见 ─────────
try { execSync("node --experimental-strip-types --check src/core/reader/reader-plus.ts", { stdio: "pipe" }); ok(true, "reader-plus.ts strip-types 通过"); }
catch { ok(false, "reader-plus.ts strip-types 通过"); }
const rp = R("src/core/reader/reader-plus.ts");
ok(/function salvageObjects/.test(rp) && /function salvageArray/.test(rp), "新增 salvageObjects/salvageArray：截断 JSON 仍救回完整对象");
ok(/salvageArray\(s, "claims"\)/.test(rp) || /SALVAGE_ARRAY_KEYS/.test(rp), "extractJson 用 salvage 救 claims/outline/nodes/edges（账本空白根因）");
const om = /OUTPUT_MAXTOK[^=]*=\s*\{([^}]*)\}/.exec(rp); const omb = om ? om[1] : "";
const led = /ledger:\s*(\d+)/.exec(omb); const cit = /citerole:\s*(\d+)/.exec(omb);
ok(led && Number(led[1]) >= 3000 && cit && Number(cit[1]) >= 3000, "账本/引文角色输出 token 提额（≥3000，避免被截成 6 条）");
ok(/function bodyFor/.test(rp) && /kind === "citerole"\)\s*return pagesTextHeadTail/.test(rp), "引文角色取材改全文头+参考文献尾（pagesTextHeadTail），不再只看前 6 页");
ok(/throw new Error\("模型输出无法解析为结构化 JSON/.test(rp) || /throw new Error\("模型 JSON 缺少 claims/.test(rp), "结构化硬失败→抛错（可见 analysisError），不再静默返回空账本");
ok(/CLAIM_ARRAY_KEYS/.test(rp) && /pickClaimsArray/.test(rp) && /outline/.test(rp), "claims 解析兼容 outline/sections/items 等别名字段");
ok(/模型未返回任何内容/.test(rp) && /均无有效文本/.test(rp), "空输出/空条目/无文本 分因抛错，不再静默空卡");
ok(/reduceLedgerClaims/.test(rp) && /LEDGER_MAX_CLAIMS/.test(rp) && /finalizeLedgerClaims/.test(rp), "账本 map→reduce 归并 + 承重论断硬上限（防 300+ 条爆炸）");
ok(/flowmap:[^]*分支/.test(rp) && /只画正文写明的环节/.test(rp), "逻辑图 prompt 去固定流水线，按论文真实结构（可分支/并行/回路）");
ok(!/预处理.{0,4}建模.{0,4}评测/.test(rp), "旧固定模板「数据→预处理→建模→评测→结论」已移除");

// ───────── Reader.jsx：Markdown 渲染 / 推读不竖排 / 账本分页+空态 / 逻辑图美化 / 默认连续 ─────────
try { execSync("node tools/jsx-syntax-check.mjs src/ui/modules/Reader.jsx", { stdio: "pipe" }); ok(true, "Reader.jsx 语法（JSX）通过"); }
catch { ok(false, "Reader.jsx 语法（JSX）通过"); }
const rd = R("src/ui/modules/Reader.jsx");
ok(/function renderInline/.test(rd) && /renderInline[\s\S]{0,600}<strong/.test(rd) && /className="rd-md-h"/.test(rd), "总结/问答按 Markdown 渲染：**粗体**→<strong>、整行→小标题，无裸星号");
ok(!/\.rd-ai-body\{[^}]*pre-wrap/.test(rd) && !/\.rd-ai-a\{[^}]*pre-wrap/.test(rd), "AI 正文去 white-space:pre-wrap（改由 .rd-md 行结构排版）");
ok(/\.inf-title\s*\{/.test(rd) && /\.inf-h\{[^}]*flex-wrap/.test(rd), "推读卡头 .inf-h 改 flex-wrap，标题 .inf-title 可占整行（修竖排）");
ok((rd.match(/className="inf-title"/g) || []).length >= 3, "三处推读卡标题均包入 .inf-title（InfCard / InfAnalyzer / 图表分析）");
ok(/citerole:[^]*被讨论到/.test(rp) && (/CITEROLE_MAX_CLAIMS/.test(rp) || /最多 20 条/.test(rp)), "引文角色 A1+：in-text 讨论 + 硬上限 20（非完整书目）");
ok(/zone === "assist"/.test(rd) && /zone === "deep"/.test(rd) && /LedgerClaimsView/.test(rd), "AI 分区懒挂载：仅渲染当前 zone（助手不再连带挂载深读账本）");
ok(/EV_PAGE_LEDGER/.test(rd) && /ledger-pager/.test(rd) && /ledger-filter/.test(rd), "账本：类型筛选 + 按页分组 + 分页");
ok(/setShown\(/.test(rd) && /className="ev-more"/.test(rd), "引文角色等证据卡仍保留展开收起");
ok(/className="ev-empty"/.test(rd) && /未.*提取到可标注页码的条目/.test(rd), "证据卡空态提示（账本/引文角色为空时不再白屏）");
ok(/className="ev-note"/.test(rd) && /不是完整参考文献表/.test(rd) && /导出到 Zotero/.test(rd), "引文角色范围注：非完整书目→导出 Zotero（不滑向文献管理器）");
ok(/function nodeColor/.test(rd) && /className="rd-gedge"/.test(rd) && /const d = "M"[\s\S]{0,90}" C"/.test(rd), "逻辑图美化：阶段配色节点 + 贝塞尔曲线连线");
ok(/重心排序/.test(rd) || /score\[ni\]/.test(rd), "逻辑图布局加确定性重心排序（减少分支连线交叉）");
ok(/const \[view, setView\] = useState\("continuous"\)/.test(rd), "PDF 默认连续滚动（view 默认 continuous）");
ok(!/&&\s*(AssistantPanel|InfCard|InfAnalyzer|EvidenceCard|EnvelopeCard|GraphCard|FlowGraph|ReaderPanel|EvidencePane|StructureMap|CiteText)\(/.test(rd), "无危险 Hook 条件调用（含新增 useState 的 EvidenceCard 仍走 <Comp/> 渲染）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
