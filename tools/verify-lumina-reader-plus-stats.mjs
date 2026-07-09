import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const bal = (s) => { const x = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/\/\/[^\n]*/g, " "); return x.split("{").length === x.split("}").length && x.split("(").length === x.split(")").length && x.split("[").length === x.split("]").length; };
console.log("── reader_plus_stats（P8 统计一致性扫描·N14·最克制）契约自检 ──");
try { execSync("node --experimental-strip-types --check src/core/reader/reader-plus.ts", { stdio: "pipe" }); ok(true, "reader-plus.ts strip-types"); } catch { ok(false, "reader-plus.ts strip-types"); }
const rd = R("src/ui/modules/Reader.jsx"); ok(bal(rd), "Reader.jsx 括号平衡");
try { execSync("node --check src/ui/lumina-bridge.js", { stdio: "pipe" }); ok(true, "lumina-bridge.js node --check"); } catch { ok(false, "lumina-bridge.js node --check"); }
const rp = R("src/core/reader/reader-plus.ts");
ok(/stats:\s*\{ lane: "inference", groundability: "L2"/.test(rp), "stats 入 KIND_REGISTRY（推断车道 L2，非 L3→不会被静态拒绝、走 runStructured）");
ok(/stats:[^]*不是判定出错/.test(rp) && /statcheck \/ GRIM/.test(rp), "stats 框定语：明示「不是判定出错」+ 指向 statcheck/GRIM 确定性重算");
ok(/stats: "扫描全文统计报告/.test(rp), "PROMPTS 含 stats");
ok(/这只是提示、不是判定出错/.test(rp) && /无法可靠核验算术/.test(rp) && /看起来……建议复核/.test(rp), "stats prompt 强制最克制：只「看起来…建议复核」、AI 无法核验算术、不断言出错");
ok(/不要断言任何数字是错的/.test(rp), "stats prompt 明令不断言任何数字是错的");
ok(/if \(kind === "stats"\) \{ claim\.confidence = "c3"; claim\.flag = "needs_recheck"; \}/.test(rp), "runStructured 对 stats 强制 c3 + needs_recheck（belt-and-suspenders，不靠模型自觉）");
const br = R("src/ui/lumina-bridge.js");
ok(/kind === "stats"[^]*confidence: "c3", flag: "needs_recheck"/.test(br) && /绝不断言出错/.test(br), "bridge stats mock：c3 + needs_recheck + 绝不断言出错");
ok(/INF_TITLES = \{[^}]*stats: "统计一致性扫描"/.test(rd) && /INF_CONF = \{[^}]*stats: "c3"/.test(rd), "Reader INF_TITLES/INF_CONF 含 stats（c3）");
ok(/<InfAnalyzer kind="stats"/.test(rd), "InferencePane 加 stats 分析器（第 4 个推断分析器）");
ok(/if \(env\.lane === "inference" \|\| env\.refused\) return <InfCard/.test(rd), "stats 结果走推断车道 InfCard（HC-1 路由不破，与 P7 ibadge/aria 一致）");
ok(/function InfAnalyzer/.test(rd) && /推断·非事实/.test(rd), "复用 P4 InfAnalyzer + P7 推断徽标（stats 自动获琥珀车道+折叠+aria+键盘）");
ok(!/&&\s*(InfCard|InfBody|EvidenceCard|EnvelopeCard|InfAnalyzer|InferencePane)\(/.test(rd), "无危险 Hook 条件调用");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
