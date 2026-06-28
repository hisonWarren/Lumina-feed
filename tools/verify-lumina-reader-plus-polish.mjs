import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const bal = (s) => { const x = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/\/\/[^\n]*/g, " "); return x.split("{").length === x.split("}").length && x.split("(").length === x.split(")").length && x.split("[").length === x.split("]").length; };
console.log("── reader_plus_polish（收尾清理：测试连接 + 文案 + 死码）契约自检 ──");
try { execSync("node --experimental-strip-types --check electron/ipc.ts", { stdio: "pipe" }); ok(true, "ipc.ts strip-types"); } catch { ok(false, "ipc.ts strip-types"); }
try { execSync("node --experimental-strip-types --check electron/preload.ts", { stdio: "pipe" }); ok(true, "preload.ts strip-types"); } catch { ok(false, "preload.ts strip-types"); }
try { execSync("node --check src/ui/lumina-bridge.js", { stdio: "pipe" }); ok(true, "lumina-bridge.js node --check"); } catch { ok(false, "lumina-bridge.js node --check"); }
const rd = R("src/ui/modules/Reader.jsx"), st = R("src/ui/modules/Settings.jsx"), rh = R("src/ui/modules/ReadHub.jsx"), ipc = R("electron/ipc.ts"), pre = R("electron/preload.ts"), br = R("src/ui/lumina-bridge.js");
ok(bal(rd) && bal(st) && bal(rh), "Reader/Settings/ReadHub 括号平衡");
// ① 测试连接
ok(/ipcMain\.handle\("llm:test"/.test(ipc) && /llmFromConfig\(llmCfg, getKey\)/.test(ipc), "ipc llm:test（复用 llmFromConfig，极小补全验证）");
ok(/maxTokens: 8/.test(ipc) && /不持久化、不回显密钥/.test(ipc), "测试用极小补全且不持久化/不回显密钥（红线3）");
ok(/testLlm: \(cfg\) => invoke\("llm:test", cfg\)/.test(pre), "preload 暴露 testLlm");
ok(/async testLlm\(cfg\)/.test(br) && /演示模式无法测试/.test(br), "bridge testLlm + 演示模式兜底");
ok(/const onTestLlm = useCallback/.test(st) && /bridge\.testLlm\(/.test(st), "Settings onTestLlm 调用 bridge.testLlm");
ok(/测试连接/.test(st) && /set-test/.test(st) && /连接成功/.test(st), "Settings「测试连接」按钮 + 成功/失败结果行");
ok(/apiKey: apiKey\.trim\(\) \|\| undefined/.test(st), "支持保存前测试当前填写的密钥（否则用钥匙串）");
// ② 死代码清理
ok(!/\.rd-lane \.pip\{/.test(rd) && !/\.rd-lane\.inf \.pip\{/.test(rd), "删除死 CSS .pip（P7 后 className=pip 已 0 用）");
ok(/\.rd-lane>svg\{/.test(rd), "lane 图标样式保留（P7 色盲可辨不受影响）");
// ③ 文案
ok(!/P2b\/P3/.test(rh) && !/后续补丁/.test(rh), "ReadHub 移除 dev 术语「后续补丁(P2b/P3)」");
ok(/划词可解释、翻译、高亮、加批注/.test(rh) && /证据 \/ 推断/.test(rh), "ReadHub 文案改为面向用户、反映当前已实现能力（含双车道）");
// 非回归
ok(/if \(env\.lane === "inference" \|\| env\.refused\) return <InfCard/.test(rd) && /推断·非事实/.test(rd), "Reader 既有双车道/路由/P7 徽标不破");
ok(/visionConsent/.test(st) && /role="switch"/.test(st), "Settings 既有视觉授权/开关 a11y 不破");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
