#!/usr/bin/env node
// verify-lumina-open-sources.mjs — structure-level checks (no network, no visual).
// Mirrors the hardened finish_all verifier: existence · ASCII bracket/backtick balance ·
// contract greps · red-line greps (on comment-stripped content) · CSS cross-ref.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASES = [join(ROOT, "files"), ROOT];
const F = (p) => {
  for (const b of BASES) {
    const full = join(b, p);
    if (existsSync(full)) return full;
  }
  return join(ROOT, p);
};
let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✓ " + m); pass++; };
const ng = (m) => { console.log("  ✗ " + m); fail++; };

const read = (p) => readFileSync(p, "utf8");
// strip block comments + FULL-LINE // comments (keep trailing // so https:// in code survives)
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const countCh = (s, c) => (s.match(new RegExp("\\" + c, "g")) || []).length;

const CODE = [
  "src/core/sources/rate-limit.ts", "src/core/sources/with-timeout.ts", "src/core/sources/adapter-meta.ts",
  "src/core/rank/stable-order.ts", "src/core/dedupe-keys.ts", "src/core/search/query-spec-ext.ts",
  "src/core/sources/semantic-scholar.ts", "src/core/sources/doaj.ts", "src/core/sources/datacite.ts",
  "src/core/sources/core.ts", "src/core/sources/lens.ts", "src/core/sources/hal.ts",
  "src/core/sources/osf-preprints.ts", "src/core/sources/zenodo.ts", "src/core/sources/openaire.ts",
  "src/core/sources/dblp.ts",
  "src/core/sources/libgen.ts", "src/core/sources/annas.ts", "src/core/sources/scihub-stub.ts",
  "src/core/locate/resolve-identifier.ts", "src/core/locate/parse-identifier.ts",
  "src/ui/fetch-meta.js",
  "src/core/oa/oa-extended.ts", "electron/settings.ts",
  "src/ui/components/HitSources.jsx", "src/ui/components/EmailPrompt.jsx", "src/ui/components/SourceKeysPanel.jsx",
  "src/ui/components/SearchDepthToggle.jsx", "src/ui/components/GoogleScholarLink.jsx",
  "src/ui/styles/open-sources.css",
];

console.log("\n[1] 文件存在");
for (const p of CODE) existsSync(F(p)) ? ok(p) : ng("缺失 " + p);
for (const t of ["tools/smoke-open-sources.ts"]) existsSync(join(ROOT, t)) ? ok(t) : ng("缺失 " + t);

console.log("\n[2] 括号/反引号平衡（ASCII；必要时剥全行注释重试）");
for (const p of CODE) {
  let s = read(F(p));
  const bal = (x) => countCh(x, "{") === countCh(x, "}") && countCh(x, "(") === countCh(x, ")") && countCh(x, "[") === countCh(x, "]");
  let okbal = bal(s);
  if (!okbal) okbal = bal(stripComments(s));   // fallback: ignore comments
  okbal ? ok("括号平衡 " + p) : ng("括号不平衡 " + p);
  if (/\.(ts|jsx)$/.test(p)) (countCh(s, "`") % 2 === 0) ? ok("反引号偶数 " + p) : ng("反引号奇数 " + p);
}

console.log("\n[3] 契约名（presence）");
const has = (p, re, name) => (re.test(read(F(p))) ? ok(name) : ng(name + " 缺失于 " + p));
has("src/core/sources/rate-limit.ts", /fetchWithRetry/, "rate-limit: fetchWithRetry");
has("src/core/sources/rate-limit.ts", /429/, "rate-limit: 429 退避");
has("src/core/sources/rate-limit.ts", /installDefaultLimiters/, "rate-limit: installDefaultLimiters");
has("src/core/sources/with-timeout.ts", /withTimeout/, "with-timeout: withTimeout");
has("src/core/sources/with-timeout.ts", /TimeoutError/, "with-timeout: TimeoutError");
has("src/core/rank/stable-order.ts", /stableMerge/, "stable-order: stableMerge");
has("src/core/rank/stable-order.ts", /adoptRanking/, "stable-order: adoptRanking");
has("src/core/dedupe-keys.ts", /dedupeKeyExt/, "dedupe-keys: dedupeKeyExt");
has("src/core/dedupe-keys.ts", /s2:/, "dedupe-keys: s2 键");
has("src/core/sources/adapter-meta.ts", /core_key/, "adapter-meta: core_key（钥匙串名）");
has("src/core/sources/adapter-meta.ts", /lens_token/, "adapter-meta: lens_token");
has("src/core/sources/adapter-meta.ts", /semanticscholar_key/, "adapter-meta: semanticscholar_key");
has("src/core/sources/semantic-scholar.ts", /x-api-key/, "s2: x-api-key 头");
has("src/core/sources/semantic-scholar.ts", /s2Id/, "s2: s2Id 载体");
has("src/core/sources/semantic-scholar.ts", /parseSemanticScholar/, "s2: parseSemanticScholar");
has("src/core/sources/doaj.ts", /gold/, "doaj: gold OA");
has("src/core/sources/datacite.ts", /parseDatacite/, "datacite: parseDatacite");
has("src/core/sources/core.ts", /parseCore/, "core: parseCore");
has("src/core/sources/lens.ts", /parseLens/, "lens: parseLens");
has("src/core/sources/hal.ts", /parseHal/, "hal: parseHal");
has("src/core/sources/osf-preprints.ts", /parseOsf/, "osf: parseOsf");
has("src/core/sources/zenodo.ts", /parseZenodo/, "zenodo: parseZenodo");
has("src/core/sources/openaire.ts", /parseOpenaire/, "openaire: parseOpenaire");
has("src/core/sources/dblp.ts", /parseDblp/, "dblp: parseDblp");
has("src/core/sources/index.ts", /dblpAdapter/, "index: dblp 注册");
has("src/core/sources/index.ts", /openaireAdapter/, "index: openaire 注册");
has("src/core/sources/index.ts", /libgenAdapter/, "index: libgen 注册");
has("src/core/sources/index.ts", /annasAdapter/, "index: annas 注册");
has("src/core/sources/index.ts", /scihubAdapter/, "index: scihub 注册");
has("src/core/locate/resolve-identifier.ts", /resolveIdentifierInput/, "locate: resolveIdentifierInput");
has("src/core/locate/parse-identifier.ts", /classifyInput/, "locate: classifyInput");
has("electron/preload.ts", /resolveIdentifier/, "preload: resolveIdentifier");
has("src/core/sources/adapter-meta.ts", /ncbi_key/, "adapter-meta: ncbi_key");
has("src/core/oa/oa-extended.ts", /missing_email/, "oa-ext: missing_email");
has("src/core/oa/oa-extended.ts", /fromCore/, "oa-ext: fromCore");
has("src/core/oa/oa-extended.ts", /fromZenodo/, "oa-ext: fromZenodo");
has("src/core/oa/oa-extended.ts", /shouldSignalMissingEmail/, "oa-ext: shouldSignalMissingEmail");
has("electron/settings.ts", /searchDepth/, "settings: searchDepth");
has("electron/settings.ts", /emailConfigured/, "settings: emailConfigured");
has("electron/settings.ts", /key\|token\|secret/, "settings: 密钥持久化防御正则");
has("src/ui/components/HitSources.jsx", /lf-sources-v2/, "HitSources: v2 class");
has("src/ui/components/HitSources.jsx", /needsKey/, "HitSources: needsKey prop");
has("src/ui/components/SourceKeysPanel.jsx", /onSaveKey/, "SourceKeysPanel: onSaveKey(钥匙串绑定)");
has("src/ui/components/SourceKeysPanel.jsx", /core_key/, "SourceKeysPanel: 钥匙串密钥名");
has("src/ui/components/SearchDepthToggle.jsx", /standard/, "DepthToggle: standard");
has("src/ui/components/SearchDepthToggle.jsx", /full/, "DepthToggle: full");
has("src/ui/components/GoogleScholarLink.jsx", /scholar\.google\.com/, "GS: 外链 URL");

console.log("\n[4] 红线/护栏（absence，剥注释后判定）");
const lacks = (p, re, name) => (re.test(stripComments(read(F(p)))) ? ng(name + " 命中于 " + p) : ok(name));
// settings.ts 绝不含 sourceKeys（代码层）
lacks("electron/settings.ts", /sourceKeys/, "settings.ts 无 sourceKeys 字段");
// adapter-meta 不含 base（F2 出局）
lacks("src/core/sources/adapter-meta.ts", /\bbase\b/, "adapter-meta 无 base 源");
// USP 适配器文件允许源名；其余 CODE 文件仍禁影子库引导词
const USP_SOURCE_FILES = new Set([
  "src/core/sources/libgen.ts", "src/core/sources/annas.ts", "src/core/sources/scihub-stub.ts",
  "src/core/sources/adapter-meta.ts", "src/ui/components/HitSources.jsx", "src/ui/fetch-meta.js",
  "src/core/sources/index.ts", "src/core/sources/rate-limit.ts", "electron/settings.ts",
]);
for (const p of CODE) {
  if (USP_SOURCE_FILES.has(p)) continue;
  const s = stripComments(read(F(p)));
  if (/sci-?hub|libgen|anna'?s? archive|annas-archive/i.test(s)) ng("盗版词命中 " + p);
}
ok("非 USP 注册文件无影子库引导词");
// SourceKeysPanel 不通过 saveSettings 写 Key
lacks("src/ui/components/SourceKeysPanel.jsx", /saveSettings\s*\(\s*\{[^}]*key/i, "SourceKeysPanel 不经 settings 存 Key");

console.log("\n[5] CSS 类交叉引用（组件用到的类已在 open-sources.css 定义）");
const css = read(F("src/ui/styles/open-sources.css"));
for (const cls of ["lf-sources-v2","lf-src-summary","lf-src-detail","lf-depth","lf-depth-opt","lf-gs","lf-gs-link",
  "lf-email-card","lf-email-bar","lf-email-inline","lf-keyrow","lf-key-in","lf-sources-panel","lf-getkey"]) {
  css.includes("." + cls) ? ok("css ." + cls) : ng("css 缺 ." + cls);
}

console.log(`\n=== verify: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
