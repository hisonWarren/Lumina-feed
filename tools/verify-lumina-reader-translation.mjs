import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
console.log("── reader_translation（阅读器：连续翻页同步 + 双页自适应 + 译文面板重做）契约自检 ──");

const RD = "src/ui/modules/Reader.jsx";
try { execSync("node tools/jsx-syntax-check.mjs " + RD, { stdio: "pipe" }); ok(true, "Reader.jsx 语法（JSX）通过"); }
catch { ok(false, "Reader.jsx 语法（JSX）通过"); }
const rd = R(RD);

// ───────── 1. 连续模式滚动联动（修：顶栏页码不动 + 重新翻译命中陈旧页，同根） ─────────
console.log("— 1. 连续模式滚动联动 —");
ok(/const onViewScroll = useCallback\(/.test(rd), "新增 onViewScroll 滚动联动回调");
ok(/onScroll=\{onViewScroll\}/.test(rd), "已接到 .rd-view 的 onScroll（替换原『仅清浮条』）");
ok(/const suppressPageScroll = useRef\(false\)/.test(rd), "suppressPageScroll 守卫（滚动改 page 时不回弹打架）");
ok(/detectContinuousPage/.test(rd) && /runScrollSpy/.test(rd), "按 detectContinuousPage 的位置判定当前主视区页");
ok(/suppressPageScroll\.current = true/.test(rd) && /setPage\(best\)/.test(rd), "滚动得到的当前页写回 page（带守卫）→ 顶栏/翻译同步");
ok(/if \(suppressPageScroll\.current\) \{ suppressPageScroll\.current = false; return; \}/.test(rd), "page→scrollIntoView 副作用读取守卫，避免与用户滚动互相打架");
ok(/scrollSpyRaf\.current/.test(rd) && /requestAnimationFrame/.test(rd), "滚动联动用 rAF 节流");
// 重新翻译/按页翻译仍以 page 为准 → 滚动同步后即翻译当前页（同一根因一并修复）
ok(/translatePage\(page, true\)/.test(rd), "「重新翻译」仍按当前 page（滚动同步后即为可见页）");
ok(/useEffect\(\(\) => \{ if \(pmapReady && !llmReady\.checking\) translatePage\(page\); \}, \[page,/.test(rd), "page 变化（含滚动联动）自动翻译该页");

// ───────── 2. 双页模式自适应 + 左页可达（修：左侧滑到头仍被裁） ─────────
console.log("— 2. 双页自适应 —");
ok(/const scaleW = \(availW \/ 2\) \/ vp\.width/.test(rd) && /const scaleH = availH \/ vp\.height/.test(rd) && /Math\.min\(scaleW, scaleH\)/.test(rd), "fitSpread 宽高双约束（整 spread 适配视区，等同双页版 fitPage）");
ok(/const availW = root\.clientWidth - 44 - 16/.test(rd), "fitSpread 扣除视区内边距(22*2)+双页间隙(16)");
ok(/spreadManualZoomRef/.test(rd), "双页手动缩放标记：+/- 后不再被自动 fit 覆盖");
ok(/if \(view !== "two"\) return;\s*\n\s*spreadManualZoomRef\.current = false/.test(rd), "进入双页时重置手动缩放并自适应一次");
ok(/sideWidth, aiOpen, transMode, rightWidth/.test(rd) && /spreadManualZoomRef\.current/.test(rd), "侧栏/右面板变化时：仅未手动缩放才 refit");
ok(/\.rd-spread\{display:flex;gap:16px;justify-content:safe center;align-self:stretch\}/.test(rd), "双页容器 safe center + 拉伸：溢出时左页可滚达（修 flex 居中裁切陷阱）");

// ───────── 3. 译文面板重做：移除双栏；段内对照=中文为主/英文次级；与助手区分 ─────────
console.log("— 3. 译文面板重做 —");
ok(/const LAYOUT_MODES = \[\["inline", "段内对照", Rows3\], \["only", "仅译文", FileText\]\];/.test(rd), "LAYOUT_MODES 仅段内对照/仅译文（双栏移除）");
ok(/\[\["inline", "段内对照"\], \["only", "仅译文"\]\]\.map/.test(rd), "工具栏译菜单同步移除双栏对照");
ok(!/mode === "dual"/.test(rd), "renderContent 不再有 dual 分支");
ok(!/rd-tp-cols/.test(rd) && !/rd-tp-col-label/.test(rd), "双栏布局类 rd-tp-cols/col-label 已清除");
ok(/className="rd-tp-unit"/.test(rd) && /className="rd-tp-zh"/.test(rd) && /className="rd-tp-en"/.test(rd), "段内对照重构为双语单元（zh 主 / en 次）");
ok(/const zh = zhRaw \? classifyBlock\(zhRaw, "tr", i\)/.test(rd), "单元复用 classifyBlock 识别小节标题（结构化）");
ok(/\.rd-tp-unit\{[^}]*border-bottom:1px solid var\(--line2\)\}/.test(rd), "单元用细线分隔（非笨重虚线/卡片）");
ok(/\.rd-tp-zh\{[^}]*font-size:14px[^}]*color:var\(--ink\)/.test(rd), "中文为主：更大字号 + 主文本色");
ok(/\.rd-tp-en\{[^}]*color:var\(--ink4\)[^}]*border-left:2px solid color-mix\(in srgb,var\(--gold\)/.test(rd), "英文为次：弱化色 + 孔雀绿细线（color-mix，六主题安全）");
ok(/\.rd-tp-eyebrow::before\{content:"";width:14px;height:2px[^}]*background:var\(--gold\)/.test(rd), "眉签用短刻度（区分助手的整条左脊 + 页码 chip）");
ok(/\.rd-tp-sec\{margin:0 0 16px;padding:0\}/.test(rd), "仅译文：去卡片化为干净阅读列");

// ───────── 4. 双页 + 翻译：明确「翻译左页」 ─────────
console.log("— 4. 双页+翻译 —");
ok(/view === "two" \? "（双页·左）" : ""/.test(rd), "双页模式翻译头标注「双页·左」（翻译以左页为准，不含糊）");
ok(/model=\{llmModel\} view=\{view\}/.test(rd), "view 传入 TranslatePanel");
ok(/function TranslatePanel\(\{ doc, page, numPages, mode, setMode, view,/.test(rd), "TranslatePanel 形参含 view");

// ───────── 5. 契约不破（红线/依赖） ─────────
console.log("— 5. 契约/红线 —");
ok(/bridge\.readerTranslate\(orig\)/.test(rd), "仍走 reader:translate 引擎（按页翻译）");
ok(/docKey, model, contentRef \}/.test(rd), "docKey/model 仍受（派生缓存契约不破，provider_translate 不回归）");
ok(/docKey=\{docKey\} model=\{llmModel\}/.test(rd), "TranslatePanel 仍传 docKey/llmModel");
ok(/llmBlocked/.test(rd) && /llmReady/.test(rd), "未配模型仍走 llm:status 守门（红线⑦：不伪造译文）");
ok(/<style>\{READER_CSS\}<\/style>/.test(rd), "READER_CSS 仍注入");
ok(!/&&\s*(TranslatePanel|TranslationPairStack|TranslationFlow|RightPanelShell)\(/.test(rd), "无危险 Hook 条件调用（含 Hook 组件均 <Comp/> 渲染）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
