#!/usr/bin/env node
// 远程模型 manifest：结构 + IPC + manifest JSON 校验
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { fail++; console.log("  ✗ " + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const manifestPath = path.join(ROOT, "config/model-catalog.json");
ok(fs.existsSync(manifestPath), "config/model-catalog.json 存在");

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  ok(manifest.schemaVersion === 1, "manifest schemaVersion=1");
  ok(manifest.providers?.openai?.models?.includes("gpt-5.5"), "manifest 含 gpt-5.5");
  ok(manifest.providers?.anthropic?.models?.length >= 3, "manifest anthropic 模型");
} catch (e) {
  fail++;
  console.log("  ✗ manifest JSON 解析失败", e.message);
}

const mc = read("src/core/summarize/model-catalog.ts");
const mb = read("src/core/summarize/model-bundled.ts");
const svc = read("electron/model-catalog-service.ts");
const ipc = read("electron/ipc.ts");
const pre = read("electron/preload.ts");
const br = read("src/ui/lumina-bridge.js");
const st = read("src/ui/modules/Settings.jsx");

ok(/MODEL_CATALOG_MANIFEST_URL/.test(mc), "MODEL_CATALOG_MANIFEST_URL");
ok(/parseModelCatalogManifest/.test(mc), "parseModelCatalogManifest");
ok(/buildEffectiveCatalog/.test(mc), "buildEffectiveCatalog");
ok(/from "\.\/model-bundled\.ts"/.test(mc), "catalog 依赖 model-bundled（无环）");
ok(/CURATED_MODELS/.test(mb), "model-bundled 导出 CURATED_MODELS");
ok(/refreshModelCatalog/.test(svc), "model-catalog-service refresh");
ok(/bootstrapModelCatalog/.test(svc), "bootstrapModelCatalog");
ok(/modelCatalog:get/.test(ipc) && /modelCatalog:refresh/.test(ipc), "IPC handlers");
ok(/modelCatalogGet/.test(pre) && /modelCatalogRefresh/.test(pre), "preload API");
ok(/modelCatalogGet/.test(br) && /modelCatalogRefresh/.test(br), "bridge API");
ok(/modelCatalogGet/.test(st) && /refreshCatalog/.test(st), "Settings 集成");
ok(/buildModelPresets/.test(st), "Settings buildModelPresets");

console.log("\n──────────────────────────────");
console.log(`  model_catalog：${fail === 0 ? "pass" : fail + " failed"}`);
process.exit(fail ? 1 : 0);
