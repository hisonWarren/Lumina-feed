#!/usr/bin/env node
/**
 * 20 源活体 API smoke：每源独立 timeout、结构化 JSON 报告。
 * 运行：cd lumina-feed && node tools/live-smoke-sources.mjs
 * 可选 env：LUMINA_CONTACT_EMAIL, CORE_KEY, LENS_TOKEN, SEMANTICSCHOLAR_KEY, NCBI_KEY
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".smoke-artifacts");
mkdirSync(OUT_DIR, { recursive: true });

async function imp(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

function loadEnvFile() {
  const p = path.join(ROOT, "..", "secrets.local.env");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const fileEnv = loadEnvFile();
const email = process.env.LUMINA_CONTACT_EMAIL || fileEnv.LUMINA_CONTACT_EMAIL || "lumina-smoke@test.local";
const keys = {
  core: process.env.CORE_KEY || fileEnv.CORE_KEY || "",
  lens: process.env.LENS_TOKEN || fileEnv.LENS_TOKEN || "",
  semanticscholar: process.env.SEMANTICSCHOLAR_KEY || fileEnv.SEMANTICSCHOLAR_KEY || "",
  ncbi: process.env.NCBI_KEY || fileEnv.NCBI_KEY || "",
};

/** 按源选更可能命中的 query（biorxiv 仅近窗过滤） */
const QUERIES = {
  pubmed: "covid vaccine",
  europepmc: "covid vaccine",
  crossref: "covid vaccine",
  openalex: "covid vaccine",
  biorxiv: "protein",
  medrxiv: "covid",
  arxiv: "transformer",
  dblp: "transformer",
  doaj: "medicine",
  hal: "machine learning",
  osf: "psychology",
  zenodo: "dataset",
  openaire: "machine learning",
  semanticscholar: "transformer",
  datacite: "research",
  core: "machine learning",
  lens: "covid vaccine",
  libgen: "machine learning",
  annas: "deep learning",
  scihub: "10.1038/nature12373",
};

function keyForAdapter(id, meta) {
  if (meta.requiresKey === "core_key") return keys.core;
  if (meta.requiresKey === "lens_token") return keys.lens;
  if (meta.optionalKey === "semanticscholar_key") return keys.semanticscholar || undefined;
  if (meta.optionalKey === "ncbi_key") return keys.ncbi || undefined;
  return undefined;
}

function needsKeySkip(id, meta) {
  if (meta.requiresKey === "core_key" && !keys.core) return "core_key";
  if (meta.requiresKey === "lens_token" && !keys.lens) return "lens_token";
  return null;
}

console.log("\n── Lumina Feed · 20 源活体 smoke ──\n");
console.log(`  contactEmail: ${email}`);
console.log(`  keys: core=${keys.core ? "yes" : "no"} lens=${keys.lens ? "yes" : "no"} s2=${keys.semanticscholar ? "yes" : "no"} ncbi=${keys.ncbi ? "yes" : "no"}\n`);

const { ALL_ADAPTERS } = await imp("src/core/sources/index.ts");
const { ADAPTER_META, timeoutFor } = await imp("src/core/sources/adapter-meta.ts");
const { rawToSpec } = await imp("src/core/querySpec.ts");
const { withTimeout, TimeoutError } = await imp("src/core/sources/with-timeout.ts");
const { setPoliteIdentity } = await imp("src/core/sources/adapter.ts");
const { installDefaultLimiters } = await imp("src/core/sources/rate-limit.ts");

setPoliteIdentity({ tool: "lumina-feed-live-smoke", email });
installDefaultLimiters();

const rows = [];
let fail = 0;

for (const adapter of ALL_ADAPTERS) {
  const id = adapter.id;
  const meta = ADAPTER_META[id] ?? { defaultEnabled: true };
  const skip = needsKeySkip(id, meta);
  if (skip) {
    rows.push({ id, status: "skipped", reason: `requires ${skip}`, ms: 0, count: 0, sample: null });
    console.log(`  ○ ${id.padEnd(16)} skipped (${skip})`);
    continue;
  }

  const qtext = QUERIES[id] ?? "machine learning";
  const spec = rawToSpec(qtext, {});
  const msLimit = timeoutFor(id);
  const t0 = Date.now();
  const searchKeys = {};
  if (keys.core) searchKeys.core = keys.core;
  if (keys.lens) searchKeys.lens = keys.lens;
  if (keys.semanticscholar) searchKeys.semanticscholar = keys.semanticscholar;
  if (keys.ncbi) searchKeys.ncbi = keys.ncbi;

  const scrapeTolerant = id === "libgen" || id === "annas";
  try {
    const hits = await withTimeout(
      adapter.search(spec, { limit: 5, keys: searchKeys }),
      msLimit,
    );
    const ms = Date.now() - t0;
    const count = hits?.length ?? 0;
    const sample = hits?.[0]?.title ? String(hits[0].title).slice(0, 72) : null;
    const emptyOk = id === "biorxiv" || id === "medrxiv";
    const status = count > 0 ? "ok" : emptyOk ? "empty_ok" : "empty";
    const required = meta.defaultEnabled !== false && !meta.requiresKey;
    if (status === "empty" && required && !scrapeTolerant) fail++;

    rows.push({ id, status, query: qtext, ms, count, sample, timeoutMs: msLimit });
    const mark = status === "ok" ? "✓" : status === "empty_ok" ? "~" : "✗";
    console.log(`  ${mark} ${id.padEnd(16)} ${String(count).padStart(3)} hits  ${ms}ms  ${sample ? "· " + sample : ""}`);
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = String(e.message || e);
    const isTimeout = e instanceof TimeoutError || /timeout/i.test(msg);
    const isNetwork = /fetch failed|ENOTFOUND|ENOENT|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg);
    const status = isTimeout ? "timeout" : isNetwork ? "network_blocked" : "error";
    if (status !== "network_blocked" && !(scrapeTolerant && (status === "timeout" || status === "empty")) && meta.defaultEnabled !== false && !meta.requiresKey) fail++;
    rows.push({ id, status, query: qtext, ms, count: 0, error: msg, timeoutMs: msLimit });
    const mark = status === "network_blocked" ? "△" : "✗";
    console.log(`  ${mark} ${id.padEnd(16)} ${status.padEnd(16)} ${ms}ms  ${msg.slice(0, 80)}`);
  }
}

const ok = rows.filter((r) => r.status === "ok").length;
const emptyOk = rows.filter((r) => r.status === "empty_ok").length;
const skipped = rows.filter((r) => r.status === "skipped").length;
const bad = rows.filter((r) => r.status === "error" || r.status === "timeout" || r.status === "empty").length;

const report = {
  at: new Date().toISOString(),
  email,
  keysPresent: { core: !!keys.core, lens: !!keys.lens, semanticscholar: !!keys.semanticscholar, ncbi: !!keys.ncbi },
  summary: { total: rows.length, ok, emptyOk, skipped, bad, failExit: fail },
  rows,
};

const outPath = path.join(OUT_DIR, "sources-live.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`\n  汇总：${ok} 命中 · ${emptyOk} 空窗可接受 · ${skipped} 跳过 · ${bad} 异常/空`);
console.log(`  报告：${outPath}`);
console.log(fail ? `\n✗ ${fail} 个 defaultEnabled 源未通过\n` : "\n✓ 活体 smoke 通过（defaultEnabled 源）\n");
process.exit(fail ? 1 : 0);
