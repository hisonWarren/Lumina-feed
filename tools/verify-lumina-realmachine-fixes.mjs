#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
function jsxSyntaxCheck(p) {
  try { execSync(`node tools/jsx-syntax-check.mjs ${p}`, { stdio: "pipe", cwd: process.cwd() }); return true; }
  catch { return false; }
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const exists = (p) => existsSync(p);
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const bal = (s) => { const x = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/\/\/[^\n]*/g, " "); return x.split("{").length === x.split("}").length && x.split("(").length === x.split(")").length && x.split("[").length === x.split("]").length; };
const tsOk = (p) => { try { execSync(`node --experimental-strip-types --check ${p}`, { stdio: "pipe" }); return true; } catch { return false; } };
const jsOk = (p) => { try { execSync(`node --check ${p}`, { stdio: "pipe" }); return true; } catch { return false; } };

console.log("── realmachine_fixes（真机问题 ISSUE-001..005）契约自检 ──");
const ipc = R("electron/ipc.ts");
const rai = R("src/core/reader/reader-ai.ts");
const br = R("src/ui/lumina-bridge.js");
const app = R("src/ui/LuminaApp.jsx");
const setg = R("src/ui/modules/Settings.jsx");
const rdr = R("src/ui/modules/Reader.jsx");
const smoke = R("tools/smoke-full-ai.mjs");

console.log("· 语法/平衡");
ok(tsOk("electron/ipc.ts"), "ipc.ts TS 语法");
ok(tsOk("src/core/reader/reader-ai.ts"), "reader-ai.ts TS 语法");
ok(bal(br), "lumina-bridge.js 平衡");
ok(jsxSyntaxCheck("src/ui/LuminaApp.jsx"), "LuminaApp.jsx 语法（jsx-syntax-check）");
ok(bal(setg), "Settings.jsx 平衡");
ok(bal(rdr), "Reader.jsx 平衡");
ok(jsOk("tools/smoke-full-ai.mjs"), "smoke-full-ai.mjs 语法");

console.log("· ISSUE-001/004 分析类 IPC 异常 → 拒绝信封（不再 null）");
ok(/function analysisError\(kind: string, e: unknown/.test(ipc), "ipc 新增 analysisError 助手");
ok(/KIND_REGISTRY/.test(ipc) && /analyzeReader/.test(ipc), "ipc 引入 KIND_REGISTRY（信封 lane 取自注册表）");
ok(/catch \(e\) \{ console\.error\("reader:analyze 失败", e\); return analysisError\(kind, e\); \}/.test(ipc), "reader:analyze catch → analysisError");
ok(/catch \(e\) \{ console\.error\("reader:figure 失败", e\); return analysisError\("figure", e, \{ vision: true/.test(ipc), "reader:figure catch → analysisError（vision 原因）");
ok(/catch \(e\) \{ console\.error\("reader:corpus 失败", e\); return analysisError\(kind, e, \{ sourceBasis: "corpus" \}\); \}/.test(ipc), "reader:corpus catch → analysisError");
ok(!/reader:analyze[\s\S]{0,400}catch \{ return null; \}/.test(ipc) && !/reader:figure[\s\S]{0,900}catch \{ return null; \}/.test(ipc), "三处 reader 分析不再 catch{return null}");
ok(/纯文本模型（如 deepseek-v4-flash）无法读图/.test(ipc), "figure 失败原因点名纯文本模型无法读图（ISSUE-001）");

console.log("· ISSUE-001③ Settings 对非视觉 provider 警告");
ok(/visionConsent && !\["openai", "anthropic", "ollama"\]\.includes\(provider\)/.test(setg), "Settings：开启读图且 provider 非视觉 → 条件警告");
ok(/可能不支持读图/.test(setg) && /set-warn/.test(setg), "警告文案 + 复用 .set-warn 样式");

console.log("· ISSUE-002 OA 取文透明 + 多源候选链");
ok(/import \{ resolvePdfCandidates \} from "\.\.\/src\/core\/oa\/oa-resolver\.ts";/.test(ipc), "ipc 引入 resolvePdfCandidates");
ok(/includeAltSources: true/.test(ipc), "oa 解析/取文启用备选渠道");
ok(/return \{ ok: true, bytes \};/.test(ipc) && /return \{ ok: false, reason: msg \};/.test(ipc), "oa:fetchPdf 结构化 {ok,bytes}|{ok:false,reason}");
ok(/fetchPdf\(url, \{ allowAltSources: true \}\)/.test(ipc), "oa:fetchPdf 启用多源 allowAltSources:true");
ok(/oa:fetchPaper/.test(ipc) && /fetchPaperPdf/.test(ipc), "oa:fetchPaper + fetchPaperPdf 统一链");
ok(/oa\.fetchPaper/.test(br), "bridge.fetchFullText 优先走 fetchPaper");
ok(/fetchFailHint\(r\.reason\)/.test(app) || /fetchFailHint\(r && r\.reason\)/.test(app), "onFetch 队列失败走 fetchFailHint");
ok(/export function fetchFailHint/.test(R("src/ui/fetch-meta.js")) && /identity_mismatch/.test(R("src/ui/fetch-meta.js")) && /publisher_blocked/.test(R("src/ui/fetch-meta.js")), "fetchFailHint 映射 identity_mismatch / publisher_blocked");
ok(/verifyPdfIdentity/.test(R("src/core/oa/provider.ts")) && exists("src/core/oa/pdf-identity.ts"), "下载后 PDF 身份校验");
ok(/pickBestLibgenRow/.test(R("src/core/oa/alt-sources.ts")), "LibGen 候选按 DOI/标题筛选");

console.log("· ISSUE-003 阅读器专用接地（groundedRatio 不再恒 0）");
ok(/function groundReaderAnswer\(answer: string, pages: ReaderPage\[\]/.test(rai), "新增 groundReaderAnswer（页锚 + token 覆盖）");
ok(/function claimPageRefs\(/.test(rai) && /\[p\\\.\(\\d\+\)\\\]/.test(rai.replace(/\\\\/g, "\\")) || /claimPageRefs/.test(rai), "claim 抽取 [p.X] 参与计分");
ok(!/buildGroundedSummary/.test(rai), "移除通用 buildGroundedSummary（逐句字符级匹配）");
ok((rai.match(/groundReaderAnswer\(answer, (picked|pages)\)/g) || []).length === 2, "askReader + summarizeReader 两处改用页锚接地");

console.log("· ISSUE-004 UI 兜底 + ISSUE-005 烟测断言");
ok((rdr.match(/请重试/g) || []).length >= 4, "Reader.jsx 四处分析 null → toast「请重试」");
ok(/run\?\.hits \|\| run\?\.papers \|\| run\?\.today/.test(smoke) && /\(run\?\.hits \|\| run\?\.papers \|\| \[\]\)\[0\]/.test(smoke), "smoke runNow 用 run.hits（ISSUE-005）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
