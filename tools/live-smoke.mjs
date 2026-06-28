#!/usr/bin/env node
// 本机烟测：引擎 + 设置持久化 + 可选网络检索（非结构级 verify）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); fail++; };
let fail = 0;

async function imp(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

console.log("\n— Lumina Feed 本机烟测 —\n");

// 1. 设置 theme 往返
try {
  const { openBetterSqlite } = await imp("src/core/store/db.ts");
  const { initStore } = await imp("src/core/store/index.ts");
  const { loadAppSettings, saveAppSettings } = await imp("electron/settings.ts");
  const dbPath = path.join(os.tmpdir(), `lumina-smoke-${Date.now()}.db`);
  const store = initStore(await openBetterSqlite(dbPath));
  await saveAppSettings(store, { contactEmail: "smoke@test.local", theme: "warm-night", llm: { provider: "deepseek", model: "deepseek-chat" } });
  const s = await loadAppSettings(store);
  if (s.contactEmail === "smoke@test.local" && s.theme === "warm-night" && s.llm?.provider === "deepseek") ok("设置持久化（含 theme + llm）");
  else bad(`设置往返异常: ${JSON.stringify(s)}`);
  store.db.close?.();
  try { fs.unlinkSync(dbPath); } catch { /* Windows 锁文件可忽略 */ }
} catch (e) {
  bad("设置持久化: " + (e.message || e));
}

// 2. 批注侧车 JSON 往返（ipc 同逻辑）
try {
  const { openBetterSqlite } = await imp("src/core/store/db.ts");
  const { initStore } = await imp("src/core/store/index.ts");
  const dbPath = path.join(os.tmpdir(), `lumina-anno-${Date.now()}.db`);
  const store = initStore(await openBetterSqlite(dbPath));
  const key = "anno:smoke.pdf:12345";
  const list = [{ id: "1", type: "highlight", page: 1, color: "yellow", text: "test" }];
  store.db.prepare(
    `INSERT INTO sources_cache(key,payload,fetched_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`
  ).run(key, JSON.stringify(list), new Date().toISOString());
  const row = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get(key);
  const got = JSON.parse(row.payload);
  if (got.length === 1 && got[0].type === "highlight") ok("批注侧车 SQLite 往返");
  else bad("批注往返失败");
  store.db.close?.();
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
} catch (e) {
  bad("批注侧车: " + (e.message || e));
}

// 3. 在线检索（真网络）
try {
  const { rawToSpec } = await imp("src/core/querySpec.ts");
  const { aggregateSearch } = await imp("src/core/aggregate.ts");
  const spec = rawToSpec("CRISPR gene editing", {});
  const agg = await aggregateSearch(spec, { limit: 5 });
  const n = agg.papers?.length ?? 0;
  if (n > 0) ok(`在线检索返回 ${n} 篇（perSource: ${Object.keys(agg.perSource || {}).join(",")}）`);
  else bad("在线检索 0 结果");
} catch (e) {
  bad("在线检索: " + (e.message || e));
}

// 4. OA PDF 取文（合法 arXiv，allowAltSources:false）
try {
  const { fetchPdf } = await imp("src/core/oa/pdf-fetch.ts");
  const url = "https://arxiv.org/pdf/1706.03762.pdf";
  const bytes = await fetchPdf(url, { allowAltSources: false });
  if (bytes && bytes.byteLength > 10000) ok(`OA 取文 OK（${Math.round(bytes.byteLength / 1024)} KB，${url}）`);
  else bad("OA 取文字节过小或为空");
} catch (e) {
  bad("OA 取文: " + (e.message || e));
}

// 5. reader-ai 无 LLM 应报错
try {
  const { summarizeReader } = await imp("src/core/reader/reader-ai.ts");
  let threw = false;
  try { await summarizeReader([{ page: 1, text: "hello" }], null); } catch { threw = true; }
  threw ? ok("reader-ai 无 LLM 正确抛错") : bad("reader-ai 无 LLM 未抛错");
} catch (e) {
  bad("reader-ai: " + (e.message || e));
}

console.log(fail ? `\n✗ 本机烟测 ${fail} 项失败\n` : "\n✓ 本机烟测全部通过\n");
process.exit(fail ? 1 : 0);
