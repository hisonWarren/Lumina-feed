import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
console.log("── reader_plus_evidence（P2 证据车道六分析器）契约自检 ──");
try { execSync("node --experimental-strip-types --check src/core/reader/reader-plus.ts", { stdio: "pipe" }); ok(true, "reader-plus.ts strip-types 通过"); }
catch { ok(false, "reader-plus.ts strip-types 通过"); }
const rp = R("src/core/reader/reader-plus.ts");
const six = ["cars", "ledger", "recipe", "repro", "falsify", "citerole"];
ok(six.every((k) => new RegExp("\\n  " + k + ":").test(rp)), "PROMPTS 含全部六分析器（cars/ledger/recipe/repro/falsify/citerole）");
ok(/status\?:\s*"ok"\s*\|\s*"warn"\s*\|\s*"no"/.test(rp), "AnalysisClaim 增 status（可复现性 ok/warn/no）");
ok(/evidenceType.*internal_data.*cites_others.*author_inference/s.test(rp) || /ledger:[^]*evidenceType/.test(rp), "ledger prompt 要求标注 evidenceType（内部数据/引用他人/作者推断）");
ok(/repro:[^]*status/.test(rp), "repro prompt 要求逐项 status，且不得把未报告说成已报告");
ok(/falsify:[^]*unstated/.test(rp), "falsify prompt：未陈述可证伪条件→flag unstated（本身是发现）");
ok(/runStructuredMapReduce/.test(rp) && /needsMapReduce/.test(rp), "长文档 map-reduce 全文扫描（runStructuredMapReduce）");
ok(/reduceLedgerClaims/.test(rp) && /LEDGER_MAX_CLAIMS/.test(rp), "账本 reduce 归并 + 承重上限（非仅 map 拼接）");
ok(/ZH_TEXT_RULE/.test(rp) && /用简体中文写每条 text/.test(rp), "结构化分析输出简体中文（保留英文术语括号）");
const rd = R("src/ui/modules/Reader.jsx");
ok(/const DEEP_TOOLS = \[/.test(rd) && six.every((k) => rd.includes('"' + k + '"')), "EvidencePane 六工具齐（DEEP_TOOLS）");
ok(/function EvidencePane\(\{ ensurePages/.test(rd) && /bridge\.readerAnalyze\(kind/.test(rd), "EvidencePane 经 reader:analyze 族运行（非各写一套）");
ok(/<EnvelopeCard env=\{env\}/.test(rd), "结果复用 EnvelopeCard（仍按 env.lane 路由，HC-1 不破）");
ok(/const PURPOSE_REC =/.test(rd) && /rec\.includes\(t\[0\]\)/.test(rd), "purpose→工具推荐（高亮 rec）");
ok(/function StatusIcon/.test(rd) && /c\.status &&/.test(rd), "可复现性 status 图标渲染（✓/⚠/⛔）");
ok(/env\.banner/.test(rd), "EvidenceCard 展示全文扫描覆盖 banner");
ok((rd.match(/const ensurePages = useCallback/g) || []).length === 1 && /function ReaderPanel/.test(rd), "ensurePages 上提到 ReaderPanel（唯一定义，两区共用）");
ok(!/&&\s*(AssistantPanel|InfCard|EvidenceCard|EnvelopeCard|ReaderPanel|EvidencePane)\(/.test(rd), "无危险 Hook 条件调用");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
