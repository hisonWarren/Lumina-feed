#!/usr/bin/env node
// 结构验证 · 各 LLM 供应商精选模型清单（model-presets.ts + Settings 同步）
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { fail++; console.log("  ✗ " + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const mp = read("src/core/summarize/model-presets.ts");
const mb = read("src/core/summarize/model-bundled.ts");
const manifest = read("config/model-catalog.json");
const st = read("src/ui/modules/Settings.jsx");
const lc = read("src/core/summarize/llm-client.ts");
const bundled = mb + manifest;

console.log("\n[1] model-bundled + manifest · 精选 + 默认");
ok(/deepseek-v4-flash/.test(bundled) && /deepseek-v4-pro/.test(bundled), "DeepSeek V4（flash + pro）");
ok(/kimi-k2\.6/.test(bundled) && !/moonshot-v1/.test(bundled), "Moonshot K2.6+（无废弃 V1）");
ok(!/moonshot-v1-8k/.test(bundled), "Moonshot 不含旧 V1 默认");
ok(/gpt-5\.5/.test(bundled) && /gpt-5\.4-mini/.test(bundled), "OpenAI 官网含 GPT-5.5 / 5.4 系列");
ok(/claude-sonnet-5/.test(bundled), "Anthropic 官网含 claude-sonnet-5");
ok(/MODEL_CATALOG_SOURCES/.test(mb), "MODEL_CATALOG_SOURCES 文档链接");
ok(/getCuratedModels/.test(mp), "mergeModelList 使用 getCuratedModels");
ok(/model-bundled/.test(mp), "model-presets 引用 model-bundled");
ok(!/apiSet\.has\(m\)/.test(mp), "mergeModelList 不因 API 缺项隐藏官网推荐");
ok(/isLikelyChatModel/.test(mp), "isLikelyChatModel 导出");

console.log("\n[2] Settings · 与 presets 同步");
ok(/model-presets\.ts/.test(st) && /PROVIDER_DEFAULT_MODEL/.test(st), "Settings 引用 model-presets");
ok(/PROVIDER_DEFAULT_MODEL\.moonshot/.test(st) && /kimi-k2\.6/.test(mb), "Kimi 默认 kimi-k2.6");
ok(/PROVIDER_DEFAULT_MODEL\.deepseek/.test(st) && /deepseek-v4-flash/.test(mb), "DeepSeek 默认 v4-flash");

console.log("\n[3] llm-client · listModels 合并");
ok(/mergeModelList/.test(lc), "listModels 调用 mergeModelList");

console.log("\n──────────────────────────────");
console.log(`  model_presets：${fail === 0 ? "pass" : fail + " failed"}`);
process.exit(fail ? 1 : 0);
