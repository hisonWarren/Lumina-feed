import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
console.log("── digest_report_redesign（今日报告：单/全分态 · 编辑式重做 · 健壮化）契约自检 ──");

const CORE = "src/core/subs/digest-report.ts";
const SUB = "src/ui/modules/Subscriptions.jsx";
const HERO = "src/ui/components/DigestReportHero.jsx";
const CSS = "src/ui/styles/subs-digest.css";

// ───────── 核心：单/全两套 prompt + 分态 token/caps + 截断救援 + 不再裸 dump ─────────
try { execSync("node --experimental-strip-types --check " + CORE, { stdio: "pipe" }); ok(true, "digest-report.ts strip-types 通过"); }
catch { ok(false, "digest-report.ts strip-types 通过"); }
const core = R(CORE);
ok(/const SYS_ALL =/.test(core) && /const SYS_SINGLE =/.test(core), "两套编辑 prompt：SYS_ALL（综合/广度）+ SYS_SINGLE（单主题/深度）");
ok(/单主题[\s\S]{0,40}深度/.test(core) && /跨主题综合概览|跨[\s\S]{0,4}主题/.test(core), "单=深度、全=综合，措辞区分明确");
ok(/generateDigestReportContent\(\s*\n?\s*inputs[\s\S]{0,120}scope: "all" \| string/.test(core) && /single \? SYS_SINGLE : SYS_ALL/.test(core), "生成按 scope 选 prompt（single→深度）");
ok(/maxTokens: single \? 3800 : 3400/.test(core), "单主题深度报告给更高 token 预算（3800 vs 3400，避免被截断）");
ok(/const CAPS_ALL:[\s\S]{0,80}const CAPS_SINGLE:/.test(core), "单/全分别设要点·主题·优先看的条数上限（CAPS_SINGLE 更宽）");
ok(/function salvageObjects/.test(core) && /function salvageArray/.test(core), "新增 salvageObjects/salvageArray：截断 JSON 仍救回完整对象");
ok(/salvageArray\(trimmed, "themes"\)/.test(core) && /salvageArray\(trimmed, "priorityPicks"\)/.test(core), "parseReportJson 解析失败时用 salvage 救 themes/priorityPicks");
ok(!/highlights: \[raw\.slice\(0, 400\)\]/.test(core) && /结构化结果不完整/.test(core), "去掉「把原始 JSON 当一条要点直接抛给用户」的旧兜底（图3 根因），改干净提示");
ok(/String\(h\)\.trim\(\)\.slice\(0, 280\)/.test(core), "每条要点限长 280（防超长 blob 撑爆版面）");
ok(/generateDigestReportContent\(inputs, llm, scope\)/.test(core), "runDigestReportGeneration 把 scope 透传给内容生成");

// ───────── 渲染层：分态标识 + 失败可自动重试一次（修「卡死在失败」）+ 透传 ─────────
try { execSync("node tools/jsx-syntax-check.mjs " + SUB, { stdio: "pipe" }); ok(true, "Subscriptions.jsx 语法（JSX）通过"); }
catch { ok(false, "Subscriptions.jsx 语法（JSX）通过"); }
const sub = R(SUB);
ok(/const scopeMode = activeSub === "all" \? "all" : "single"/.test(sub) && /const scopeLabel =/.test(sub), "派生 scopeMode/scopeLabel（区分今日全部简报 vs 单订阅）");
ok(/if \(digestReport\?\.status === "failed"\)/.test(sub) && /reportRetryRef\.current\[reportScope\]/.test(sub), "失败报告自动重试一次（按 scope 计数，修「failed 不在 stale 条件里→永不重试」）");
ok(/reportRetryRef\.current\[reportScope\] = 0/.test(sub), "成功后清零重试计数（后续再失败仍可重试，且不死循环）");
ok(/今日报告由「设置 → 简报报告」总开关统一控制/.test(sub), "C1：订阅编辑澄清「不自动总结」≠ 今日报告");
ok((sub.match(/scopeMode=\{scopeMode\}/g) || []).length >= 2 && (sub.match(/scopeLabel=\{scopeLabel\}/g) || []).length >= 2, "scopeMode/scopeLabel 同时传给 Hero 与 Reader");
ok(/if \(force\)[\s\S]{0,120}pushToast/.test(sub), "B2：自动/静默生成（force=false）不弹「报告已就绪」toast");
try { execSync("node tools/jsx-syntax-check.mjs " + HERO, { stdio: "pipe" }); ok(true, "DigestReportHero.jsx 语法（JSX）通过"); }
catch { ok(false, "DigestReportHero.jsx 语法（JSX）通过"); }
const hero = R(HERO);
ok(/function ReportLede/.test(hero), "抽出共享展示件 ReportLede（Reader 页眉）");
ok(/function ReportSections/.test(hero), "抽出共享展示件 ReportSections（Reader 完整报告用）");
ok((hero.match(/<ReportSections\b/g) || []).length >= 1, "Reader 用 <ReportSections/> 渲染完整报告（Hero 扫描列表仅一段话简报）");
ok(/function ModeTag/.test(hero) && /单订阅 · 深度/.test(hero) && /全部订阅 · 综合/.test(hero), "模式徽标区分「单订阅·深度」/「全部订阅·综合」");
ok(/data-mode=\{mode\}/.test(hero), "根节点带 data-mode（CSS 据此分态：单订阅脊柱更重等）");
ok(/className="dg-rp-pick-n"/.test(hero) && /className="dg-rp-pick"/.test(hero), "「值得优先看」改 flex 顶对齐序号圆点结构（修序号错位）");
ok(/report\?\.status === "failed"/.test(hero) && /重试生成/.test(hero), "失败态可操作：内联「重试生成」（不再只弹一闪而过的 toast）");
ok(/原因：\$\{report\.error\}/.test(hero), "失败态显示真实 error 原因（API 错误时可读）");
ok(/noLlm && onOpenSettings/.test(hero), "未配置大模型时给「去设置」直达（依赖：设置 → 大模型）");
ok(/function InferTag/.test(hero) && /由你判断/.test(hero), "保留接地/诚实标签「AI 推断 · 由你判断」（红线②/④）");
ok(/const titles = paperTitleById \|\| \{\}/.test(hero) && /title=\{titles\[id\] \|\| "跳转到该文献"\}/.test(hero), "跳转链接仍显真实标题（subs_report_jump 契约不破）");
ok(!/&&\s*(ReportSections|ReportLede|ModeTag|InferTag|DigestReportHero|DigestReportReader)\(/.test(hero), "无危险 Hook 条件调用（共享件以 <Comp/> 渲染）");

// ───────── 视觉：受限阅读宽（修「整个宽度」）+ 编辑式件 + 主题变量/无障碍 ─────────
const css = R(CSS);
ok(/\.dg-rp-reader\{max-width:760px/.test(css), "今日报告受限阅读宽 760（修「计算用整个面板宽、行太长」）");
ok(/\.dg-rp-state\{[^}]*max-width:520px[^}]*margin:30px auto/.test(css), "加载/失败/未就绪状态居中成卡（修「空荡全宽」状态）");
ok(/\.dg-rp-eyebrow::after\{[^}]*linear-gradient/.test(css), "章节眉标题带渐隐细线（编辑式分节）");
ok(/\.dg-rp-points li::before\{[^}]*border-radius:50%[^}]*background:var\(--gold\)/.test(css), "今日要点用自定义孔雀绿圆点（非默认 disc）");
ok(/\.dg-rp-theme\{[^}]*border:1px solid var\(--line2\)[^}]*border-radius/.test(css), "主题分组卡片化");
ok(/\.dg-rp-pick-n\{[^}]*place-items:center[^}]*Source Serif/.test(css) && /\.dg-rp-pick\{[^}]*align-items:flex-start/.test(css), "优先看序号为顶对齐衬线圆点（版式修正落到 CSS）");
ok(/\.dg-rp-link-t\{[^}]*text-overflow:ellipsis/.test(css), "文献链标题省略号限宽（长标题不撑破）");
ok((css.match(/color-mix\(in srgb,var\(--gold\)/g) || []).length >= 6, "强调色统一走 var(--gold)+color-mix（六主题安全，无写死十六进制）");
ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*dg-rp-/.test(css), "reduced-motion 降级（无障碍）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
