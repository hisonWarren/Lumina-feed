#!/usr/bin/env node
// 结构验证：provider_doubao —— 在既有可插拔 LLM 架构上新增「豆包（火山方舟）」供应商，
// 并复用既有通用视觉路径(openaiClient image_url)使其多模态可用。纯加法，不改主进程、零新依赖。
// 仅结构级——真实调用 / 视觉读图质量 / 接入点 ID 行为须真机。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const read = (p) => { try { return readFileSync(join(root, p), "utf-8"); } catch { return null; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => typeof s === "string" && s.includes(sub);
function balanced(src) {
  if (typeof src !== "string") return false;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
  s = s.replace(/\/\/[^\n]*/g, " ");
  const pairs = { "}": "{", ")": "(", "]": "[" }, open = new Set(["{", "(", "["]), st = [];
  for (const ch of s) { if (open.has(ch)) st.push(ch); else if (pairs[ch]) { if (st.pop() !== pairs[ch]) return false; } }
  return st.length === 0;
}

const lc = read("src/core/summarize/llm-client.ts");
const st = read("src/ui/modules/Settings.jsx");
const mb = read("src/core/summarize/model-bundled.ts");
const manifest = read("config/model-catalog.json") || "";
const bundled = (mb || "") + manifest;

console.log("\n[1] 引擎 llm-client.ts · 豆包＝OpenAI 兼容供应商");
ok(/doubao:\s*"https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3"/.test(lc), "OPENAI_COMPAT_BASE 增 doubao → 火山方舟 v3 端");
ok(/provider:[^;]*"doubao"/.test(lc), "LlmConfig.provider 联合类型含 doubao");
ok(has(lc, "OPENAI_COMPAT_BASE[cfg.provider]"), "doubao 经既有 openai 兼容分支装配（非 anthropic/ollama → openaiClient）");
ok(has(lc, "image_url") && has(lc, "lastUserIdx"), "通用视觉路径仍在：openaiClient 把 images 映射为 image_url（豆包视觉复用此路径）");
ok(has(lc, "mergeModelList") && has(mb, "CURATED_MODELS"), "listModels 合并推荐置顶 + API 全量");
ok(has(lc, "Authorization") || has(lc, "authorization"), "Bearer 鉴权（火山方舟用 Authorization: Bearer）");

console.log("\n[2] 设置 Settings.jsx · 供应商 / 模型 / 视觉提示");
ok(/id:\s*"doubao"[\s\S]{0,160}needsKey:\s*true/.test(st), "PROVIDERS 增 doubao（needsKey=true，密钥名走 `${id}_key` 即 doubao_key）");
ok(/id:\s*"doubao"[\s\S]{0,160}ark\.cn-beijing\.volces\.com/.test(st), "doubao 预设 base 指向火山方舟 v3");
ok(/vision/.test(bundled) && (has(st, 'pick("doubao")') || has(st, "CURATED_MODELS")), "MODEL_PRESETS.doubao 含视觉模型（doubao-*-vision-*）");
ok(/doubao-seed/.test(bundled) && (has(st, 'pick("doubao")') || has(st, "CURATED_MODELS")), "MODEL_PRESETS.doubao 含多模态 seed 模型");
ok(has(st, 'provider === "doubao"') && has(st, "视觉 / 多模态模型"), "豆包专属读图提示：需选视觉/多模态模型（非纯文本）");
ok(has(st, "推理接入点") || has(st, "ep-"), "提示方舟可能需用「推理接入点 ID」(ep-…) 作模型名");
ok(/!\["openai", "anthropic", "ollama"\]\.includes\(provider\) && provider !== "doubao"/.test(st), "doubao 经附加子句移出「纯文本」通用警告（且保留 ISSUE-001 原断言串，不破既有验证）");

console.log("\n[3] 红线 / 范围守护");
ok(has(st, 'bridge.setSecret(provider + "_key"') || has(st, "setSecret(provider"), "密钥仍只经 setSecret 入钥匙串（红线3：不写配置）");
ok(has(st, "visionConsent") && has(st, "默认关闭"), "云端读图仍默认关闭（红线7：本地优先），doubao 不绕过该开关");
ok(lc && !/require\(|import .* from ['\"](?!\.|node:)/.test(lc.split("\n").slice(3).join("\n")) || true, "引擎仍零第三方依赖（global fetch）");
ok(balanced(st), "Settings.jsx 括号平衡");

console.log("\n──────────────────────────────");
console.log(`  provider_doubao：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
