import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
console.log("── subs_report_jump（今日简报：报告滚动 + 跳转文献修复）契约自检 ──");

const SUB = "src/ui/modules/Subscriptions.jsx";
const HERO = "src/ui/components/DigestReportHero.jsx";
const CSS = "src/ui/styles/subs-digest.css";

// 语法
try { execSync("node tools/jsx-syntax-check.mjs " + SUB, { stdio: "pipe" }); ok(true, "Subscriptions.jsx 语法（JSX）通过"); }
catch { ok(false, "Subscriptions.jsx 语法（JSX）通过"); }
try { execSync("node tools/jsx-syntax-check.mjs " + HERO, { stdio: "pipe" }); ok(true, "DigestReportHero.jsx 语法（JSX）通过"); }
catch { ok(false, "DigestReportHero.jsx 语法（JSX）通过"); }

const sub = R(SUB), hero = R(HERO), css = R(CSS);

// ───────── 修复 1：报告 Hero 从固定表头(.dg-head)移入可滚动列表(.dg-list)，不再挤压/截断 ─────────
const idxList = sub.indexOf('className="dg-list"');
const idxHead = sub.indexOf('className="dg-head"');
const idxHero = sub.indexOf("<DigestReportHero");
ok((sub.match(/<DigestReportHero/g) || []).length === 1, "DigestReportHero 仅渲染一处（去重，避免表头/列表两份）");
ok(idxHero > idxList && idxList > 0, "DigestReportHero 现位于 .dg-list（可滚动区）内，而非固定表头");
ok(idxHead >= 0 && !sub.slice(idxHead, idxList).includes("<DigestReportHero"), "固定表头 .dg-head 内已不含报告 Hero（消除溢出截断根因）");
ok(/viewMode === "scan" && \(\s*<DigestReportHero/.test(sub), "Hero 仅在扫描列表视图渲染（report 视图用 Reader）");

// ───────── 修复 2：jumpToPaper 健壮化（展开分组 + 等待挂载 + 高亮），并修可见性 ─────────
ok(/import React, \{[^}]*useRef[^}]*\} from "react"/.test(sub), "引入 useRef（groupsRef 供 jumpToPaper 读取当前分组）");
ok(/groupsRef\.current/.test(sub), "jumpToPaper 经 groupsRef 读取当前分组（deps[] 也不取到陈旧值）");
ok(/setLoadMore\(\(m\) => \{ const need = idx \+ 1;/.test(sub), "跳转前展开目标所在分组分页（修：被「加载更多」折叠的文献跳不到）");
ok(/if \(tries\+\+ < \d+\) requestAnimationFrame\(tick\)/.test(sub), "等卡片挂载再滚动（修：从『今日报告』切回时单帧 rAF 太早、DOM 未提交）");
ok(/el\.classList\.add\("dg-item-flash"\)/.test(sub), "跳转到目标后高亮闪烁（用户能看清落点）");
ok(/@keyframes dgItemFlash/.test(sub) && /prefers-reduced-motion[\s\S]*dg-item-flash\{animation:none/.test(sub), "闪烁动画定义 + reduced-motion 降级（无障碍）");

// ───────── 修复 3：主题分组「跳转文献」改显真实标题（替代千篇一律占位） ─────────
ok(/paperTitleById/.test(sub) && (sub.match(/paperTitleById=\{paperTitleById\}/g) || []).length >= 2, "Subscriptions 构建 id→标题映射并传给 Hero 与 Reader");
ok(/const titles = paperTitleById \|\| \{\}/.test(hero) && /title=\{titles\[id\] \|\| "跳转到该文献"\}/.test(hero), "Hero 主题链接显示真实标题（带 title 提示），不再一律「跳转文献」");
ok(/\{titles\[id\] \|\| "跳转文献"\}/.test(hero), "无标题时回退「跳转文献」占位（仍可点）");
ok((hero.match(/<ReportSections\b/g) || []).length >= 2 && /className="dg-rp-link"/.test(hero), "「今日报告」与 Hero 复用同一 ReportSections（两视图主题均提供跳转链接，原先只有『值得优先看』可跳）");
ok(/const jump = \(id\) => onJumpPaper && onJumpPaper\(id\)/.test(hero), "跳转回调有空值守卫（onJumpPaper 缺省不崩）");

// ───────── 链接样式：标题可读（省略号 + 限宽 + 非等宽） ─────────
ok(/\.dg-report-link\{[^}]*text-overflow:ellipsis/.test(css) && /\.dg-report-link\{[^}]*max-width:/.test(css), "跳转链接限宽 + 省略号（长标题不撑破布局）");

// ───────── Hook 安全（含 useRef 的组件仍以 <Comp/> 渲染） ─────────
ok(!/&&\s*(DigestReportHero|DigestReportReader|DigestItem|SubDialog)\(/.test(sub), "无危险 Hook 条件调用");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
