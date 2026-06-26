#!/usr/bin/env node
// synra_patch_lumina_redesign · verify
//   node tools/verify-lumina-redesign.mjs <target>
// 结构断言每个修复都"改对了"。视觉/端到端效果须真机(无 Electron/网络/npm)。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const T = process.argv[2] || ".";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗ FAIL", m); };
const read = (p) => { try { return readFileSync(join(T, p), "utf8"); } catch { return ""; } };
const has = (s, ...x) => x.every((q) => s.includes(q));

const obs = read("src/ui/Observatory.jsx");
const ux = read("src/ui/lumina-ux.jsx");
const themes = read("src/ui/themes.js");
const llm = read("src/core/summarize/llm-client.ts");
const main = read("electron/main.ts");
const preload = read("electron/preload.ts");

console.log("— ①②⑩⑪ 布局自适应(黑边/重叠/侧栏被盖/关闭被切) —");
ok(has(obs, "height:100vh") && !has(obs, "height:820px"), "根容器 100vh，去固定 820px");
ok(!has(obs, "border-radius:16px; border:1px solid var(--line);"), "去圆角+边框(黑边主因)");
ok(has(obs, "html,body,#root{height:100%"), "html/body 满高");
ok(has(obs, "body{background:#F4F4F1}"), "页面浅底(杜绝漏黑)");
ok(has(obs, ".lf-stage{position:relative; z-index:2; display:flex; flex-direction:column; flex:1; min-height:0}"), "舞台弹性铺满");
ok(has(obs, ".lf-drawer{position:fixed; top:34px"), "抽屉移到标题栏之下(关闭完整)");
ok(has(obs, ".lf-scrim{position:fixed; inset:0; top:34px"), "遮罩同步下移");

console.log("— ④⑨ 去 Claude 味(配色/字体) —");
ok(has(obs, "--gold:#0E7C6F") && !has(obs, "--gold:#A86E22"), "默认主色 petrol 替代金");
ok(has(themes, '"#0E7C6F"') && !has(themes, '"#A86E22"'), "themes 默认主题同步 petrol");
ok(!has(obs, "Fraunces"), "去除 Fraunces 花体");
ok(has(obs, "Source+Serif+4") && has(obs, "Source Serif 4"), "衬线换 Source Serif 4");
ok(has(obs, ".lf-title{font-family:var(--sans)"), "结果标题改 Inter sans");
ok(!has(obs, "#F6D391"), "写死金渐变全部改为主题变量驱动");
ok(has(obs, ".lf.day .lf-segbtn.on, .lf.day .lf-seg.on"), "day 填充按钮白字(对比)");

console.log("— ①⑥⑦ 信息架构(检索为核心/空查询不盲搜/默认无订阅) —");
ok(has(obs, 'useState("explore")'), "默认着陆=探索(检索)");
ok(has(obs, "if (!q.trim()) { setPapers([]); setLoading(false); setSearchErr(null); return; }"), "空查询守卫(不盲搜→不造垃圾)");
ok(has(obs, "lf-prompt") && has(obs, "检索文献，获取合法全文"), "检索引导态(核心:检索+全文下载)");
ok(has(obs, "hasBackend() ? subs :"), "live 不回退 mock 订阅");
ok(has(obs, "lf-emptysub") && has(obs, "还没有订阅") , "无订阅空态引导");

console.log("— ⑧ doi 真打开 —");
ok(has(main, '"shell:openExternal"') && has(main, "shell.openExternal"), "主进程 openExternal handler");
ok(has(main, 'import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell }'), "main 引入 shell");
ok(has(preload, "openExternal: (url") && has(preload, '"shell:openExternal"'), "preload 暴露 openExternal");
ok(has(obs, "openExternal") && has(obs, "https://doi.org/") && !has(obs, 'href="#" onClick={(e) => e.preventDefault()}>doi'), "doi 链接真打开 doi.org");

console.log("— ⑫ 主题浮层锚定 —");
ok(has(ux, "top:calc(100% + 8px)") && has(ux, "z-index:300"), "浮层锚到按钮正下方 + 最高层");

console.log("— ⑬ DeepSeek 真可用(引擎+UI) —");
ok(has(llm, "OPENAI_COMPAT_BASE") && has(llm, "https://api.deepseek.com"), "引擎加 DeepSeek 兼容 base");
ok(has(llm, '"deepseek"'), "LlmConfig 支持 deepseek");
ok(has(ux, '["deepseek"') && has(ux, "deepseek-chat"), "设置面板含 DeepSeek + 模型提示");
ok(has(ux, "NEEDS_BASE") && has(ux, "OpenAI 兼容"), "自定义兼容端点(base URL)");

console.log("— 红线保持(重构不破红线) —");
ok(has(obs, "AI 不裁判") || has(obs, "纳入/排除"), "AI 不替做纳入/排除");
ok(has(obs, "fetchFullText") && !has(obs, "scihub") && !has(obs, "libgen"), "取全文仅合法 OA(无影子库)");
ok(has(ux, "钥匙串") || has(ux, "setSecret"), "密钥走钥匙串");
ok(has(obs, "检索文献，获取合法全文"), "全文获取强调'合法'");

console.log("— 接线不回归(会议4 成果保留) —");
ok(has(obs, "bridge.searchOnline") && has(obs, "bridge.summarize") && has(obs, "bridge.fetchFullText"), "检索/总结/取全文仍接真引擎");
ok(has(obs, "const live = hasBackend()"), "hasBackend 双模仍在");

console.log("— 文档项 —");
const reP = join(HERE, "..", "00_analysis", "ROLE_EVALUATION.md");
const re = existsSync(reP) ? readFileSync(reP, "utf8") : "";
ok(re && has(re, "是否从零重构"), "ROLE_EVALUATION 含'是否从零重构'判定");
ok(re && has(re, "逐条对账"), "ROLE_EVALUATION 含逐条对账表");
ok(re && has(re, "保留异议"), "ROLE_EVALUATION 含保留异议");

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
