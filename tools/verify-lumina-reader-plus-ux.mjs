import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const bal = (s) => { const x = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/\/\/[^\n]*/g, " "); return x.split("{").length === x.split("}").length && x.split("(").length === x.split(")").length && x.split("[").length === x.split("]").length; };
console.log("── reader_plus_ux（P7 UX 收口 + a11y）契约自检 ──");
const rd = R("src/ui/modules/Reader.jsx"), lb = R("src/ui/modules/Library.jsx"), st = R("src/ui/modules/Settings.jsx");
ok(bal(rd), "Reader.jsx 括号平衡"); ok(bal(lb), "Library.jsx 括号平衡"); ok(bal(st), "Settings.jsx 括号平衡");
// reduced-motion
ok(/prefers-reduced-motion/.test(rd) && /prefers-reduced-motion/.test(lb) && /prefers-reduced-motion/.test(st), "三模块均加 prefers-reduced-motion（动效尊重系统设置）");
ok(/\.rd-spin\{animation:none\}/.test(rd), "reduced-motion 停止加载旋转");
// 色盲可辨双车道 = 图标 + 标签 + 边框（非仅颜色）
ok((rd.match(/推断·非事实/g) || []).length === 2, "推断卡加文字徽标「推断·非事实」（InfCard + InfAnalyzer，与证据卡对称）");
ok(/接地·带页码/.test(rd), "证据卡保留文字徽标「接地·带页码」");
ok(/rd-lane"><Shield/.test(rd) && /rd-lane inf"><Lightbulb/.test(rd), "lane 条用图标（Shield 证据 / Lightbulb 推断）非仅色点");
ok(/\.ev-card\{[^}]*border-left:4px solid var\(--gold\)/.test(rd) && /\.inf-card\{border:1px dashed/.test(rd), "证据卡实线左bar / 推断卡虚线边框——边框样式可辨（非仅颜色）");
ok(/\.ibadge\{[^}]*var\(--amberDim\)/.test(rd), "ibadge 琥珀样式存在");
// ARIA
ok(/role="tablist"/.test(rd) && /role="tab" aria-selected=\{zone/.test(rd), "4 区 tabs：role=tablist/tab + aria-selected");
ok((rd.match(/aria-expanded=\{open\}/g) || []).length >= 2, "推断可折叠卡 aria-expanded（InfCard + InfAnalyzer）");
ok((rd.match(/e\.key === "Enter" \|\| e\.key === " "/g) || []).length >= 2, "可折叠卡键盘可达（Enter/Space 切换）");
ok(/aria-pressed=\{purpose/.test(rd), "目的 chips aria-pressed");
ok(/aria-label=\{t\[1\] \+ "：" \+ t\[2\]\}/.test(rd), "深读工具按钮 aria-label");
ok(/aria-label="从写作 swipe file 移除"/.test(rd), "swipe 移除按钮 aria-label");
ok(/aria-pressed=\{selMode\}/.test(lb) && /role="checkbox" aria-checked=\{sel\.has/.test(lb), "Library 跨篇开关 aria-pressed + 选择框 role=checkbox/aria-checked");
ok((st.match(/role="switch" aria-checked=/g) || []).length >= 2, "Settings 开关均 role=switch + aria-checked（云端读图 / 通知 / 后台 / 自启等，background 补丁后 ≥2）");
// 契约/非回归（HC-1 + 不破功能）
ok(/if \(env\.lane === "inference" \|\| env\.refused\) return <InfCard/.test(rd), "EnvelopeCard 仍只按 env.lane 路由（HC-1 不破）");
ok(/function InfAnalyzer/.test(rd) && /CorpusCard/.test(lb) && /visionConsent/.test(st), "P4/P6/P5 既有功能标记仍在（无回归）");
ok(!/&&\s*(AssistantPanel|InfCard|InfBody|EvidenceCard|EnvelopeCard|ReaderPanel|EvidencePane|InferencePane|InfAnalyzer|CorpusCard)\(/.test(rd) && !/&&\s*CorpusCard\(/.test(lb), "无危险 Hook 条件调用");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
