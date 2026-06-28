#!/usr/bin/env node
// 结构验证 · 各 LLM 供应商精选模型清单（model-presets.ts + Settings 同步）
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { fail++; console.log("  ✗ " + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const mp = read("src/core/summarize/model-presets.ts");
const st = read("src/ui/modules/Settings.jsx");
const lc = read("src/core/summarize/llm-client.ts");

console.log("\n[1] model-presets.ts · 精选 + 默认");
ok(/deepseek-v4-flash/.test(mp) && /deepseek-v4-pro/.test(mp), "DeepSeek V4（flash + pro）");
ok(/kimi-k2\.6/.test(mp) && !/kimi-k2[^.]/.test(mp.replace(/kimi-k2\./g, "")), "Moonshot K2.6+（无废弃 kimi-k2）");
ok(!/moonshot-v1-8k/.test(mp), "Moonshot 不含旧 V1 默认");
ok(/gpt-4o-mini/.test(mp) && !/\bo3\b/.test(mp), "OpenAI 常用四档（无 o 系列推理）");
ok(/filterCuratedModels/.test(mp), "filterCuratedModels 导出");

console.log("\n[2] Settings · 与 presets 同步");
ok(/model-presets\.ts/.test(st) && /PROVIDER_DEFAULT_MODEL/.test(st), "Settings 引用 model-presets");
ok(/PROVIDER_DEFAULT_MODEL\.moonshot/.test(st) && /kimi-k2\.6/.test(mp), "Kimi 默认 kimi-k2.6");
ok(/PROVIDER_DEFAULT_MODEL\.deepseek/.test(st) && /deepseek-v4-flash/.test(mp), "DeepSeek 默认 v4-flash");

console.log("\n[3] llm-client · listModels 过滤");
ok(/filterCuratedModels/.test(lc), "listModels 调用 filterCuratedModels");

console.log("\n──────────────────────────────");
console.log(`  model_presets：${fail === 0 ? "pass" : fail + " failed"}`);
process.exit(fail ? 1 : 0);
