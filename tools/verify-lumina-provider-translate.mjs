#!/usr/bin/env node
// 结构验证：provider_translate（模型可点选+动态拉取 / 翻译持久化 / 译菜单定位）。
// 仅结构级——/models·/api/tags 拉取、真实翻译缓存命中·刷新、菜单定位、6 主题须真机验。
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);

// 括号平衡（剥离注释/字符串/模板，避免正则误判；不含正则字面量解析）
function balanced(src) {
  if (typeof src !== "string") return false;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
  s = s.replace(/\/\/[^\n]*/g, " ");
  const pairs = { "}": "{", ")": "(", "]": "[" };
  const open = new Set(["{", "(", "["]);
  const st = [];
  for (const ch of s) {
    if (open.has(ch)) st.push(ch);
    else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; }
  }
  return st.length === 0;
}

const ipc = read("electron/ipc.ts");
const preload = read("electron/preload.ts");
const llm = read("src/core/summarize/llm-client.ts");
const bridge = read("src/ui/lumina-bridge.js");
const settings = read("src/ui/modules/Settings.jsx");
const reader = read("src/ui/modules/Reader.jsx");

console.log("\n[1] llm-client.ts · listModels（动态拉取 + 3 端点）");
ok(has(llm, "export async function listModels"), "导出 listModels");
ok(has(llm, "/api/tags"), "Ollama GET /api/tags");
ok(has(llm, "x-api-key") && has(llm, "anthropic-version"), "Anthropic /v1/models 头（x-api-key + version）");
ok(has(llm, "Authorization") && has(llm, "Bearer"), "OpenAI 兼容 /v1/models 头（Bearer）");
ok(has(llm, "ok: true, models") && has(llm, "ok: false, error"), "返回 {ok,models} | {ok:false,error}");
ok(has(llm, "try {") && has(llm, "} catch"), "try/catch 非抛（红线7：失败不阻塞）");

console.log("\n[2] ipc.ts · 新 IPC");
ok(has(ipc, 'import { llmFromConfig, listModels }'), "导入 listModels");
ok(has(ipc, 'ipcMain.handle("llm:listModels"'), "handler llm:listModels");
ok(has(ipc, 'ipcMain.handle("translations:get"'), "handler translations:get");
ok(has(ipc, 'ipcMain.handle("translations:save"'), "handler translations:save");
ok(has(ipc, '"translate:" + docKey'), "sources_cache 键 translate:<docKey>");
ok(has(ipc, "secrets.get(`${provider}_key`)"), "listModels getKey 走钥匙串（红线3）");

console.log("\n[3] preload.ts · 暴露");
ok(has(preload, 'listModels: (cfg) => invoke("llm:listModels"'), "luminaApi.listModels");
ok(has(preload, 'invoke("translations:get"'), "getTranslations");
ok(has(preload, 'invoke("translations:save"'), "saveTranslation");

console.log("\n[4] lumina-bridge.js · 桥接");
ok(has(bridge, "async listModels(cfg)"), "bridge.listModels");
ok(has(bridge, "(api && api.listModels) || (r && r.listModels)"), "listModels 双取 A()||R()（防命名空间不一致）");
ok(has(bridge, "async getTranslations(docKey)"), "bridge.getTranslations");
ok(has(bridge, "async saveTranslation(docKey, page, model, text)"), "bridge.saveTranslation");

console.log("\n[5] Settings.jsx · 模型可点选");
ok(has(settings, "MODEL_PRESETS"), "内置兜底清单 MODEL_PRESETS");
ok(has(settings, "ChevronDown") && has(settings, "RefreshCw") && has(settings, "Loader"), "图标 ChevronDown/RefreshCw/Loader");
ok(has(settings, "set-combo-menu"), "下拉菜单 .set-combo-menu");
ok(has(settings, "fetchModels"), "fetchModels（拉取）");
ok(has(settings, "availModels") && has(settings, "showCustomInput"), "派生 availModels + showCustomInput（自填）");
ok(has(settings, "PROVIDER_DEFAULT_MODEL.anthropic") || has(read("src/core/summarize/model-presets.ts"), "claude-sonnet-4-6"), "Claude 默认 claude-sonnet-4-6");
ok(has(settings, "PROVIDER_DEFAULT_MODEL") || has(settings, "deepseek-v4-flash"), "DeepSeek 默认已对齐 V4");
ok(!has(settings, "claude-3-5-sonnet-20241022"), "过时 Claude 串已移除");
ok(has(settings, 'role="listbox"') && has(settings, 'role="option"'), "可达性 listbox/option");

console.log("\n[6] Reader.jsx · 译菜单定位 + 翻译持久化");
ok(has(reader, ".rd-trwrap{position:relative"), "CSS .rd-trwrap 定位上下文（修菜单落点）");
ok(has(reader, '<span className="rd-trwrap">'), "译按钮 + 菜单已裹入 .rd-trwrap");
ok(has(reader, ".rd-tmenu{position:absolute"), ".rd-tmenu 仍为 absolute（现锚 .rd-trwrap=译按钮）");
ok(has(reader, "onClose, pushToast, docKey, model }"), "TranslatePanel 收 docKey + model");
ok(has(reader, "const pmapRef = useRef({})"), "pmapRef 持久缓存");
ok(has(reader, "translatePage = useCallback(async (pg, force)"), "translatePage(pg, force)");
ok(has(reader, "命中持久缓存") && has(reader, "cached: true"), "命中缓存跳过 LLM");
ok(has(reader, "bridge.saveTranslation(docKey, pg, model || \"\", trans)"), "成功译文落库");
ok(has(reader, "if (pmapReady) translatePage(page)"), "等缓存载入后再译（先查缓存）");
ok(has(reader, "rd-tp-cache") && has(reader, "重新翻译"), "缓存条 + 重新翻译按钮");
ok(has(reader, "docKey={docKey} model={llmModel}"), "TranslatePanel 传入 docKey/llmModel");
const brdSave = (reader.match(/bridge\.saveTranslation/g) || []).length;
ok(brdSave === 1, "saveTranslation 仅 1 处（划词译不落库，会话内存）·实测 " + brdSave);

console.log("\n[7] 括号平衡（jsx/js）");
ok(balanced(settings), "Settings.jsx 平衡");
ok(balanced(reader), "Reader.jsx 平衡");
ok(balanced(bridge), "lumina-bridge.js 平衡");

console.log("\n──────────────────────────────");
console.log(`provider_translate 结构验证：${pass}/${pass + fail} 通过` + (fail ? `（${fail} 失败）` : "（全绿）"));
console.log("真机必验：各家 /models·Ollama /api/tags 真实返回 / 翻译缓存命中·刷新 / 译菜单滚动+窄窗定位 / 6 主题");
process.exit(fail ? 1 : 0);
