#!/usr/bin/env node
/** verify · 工作集 ↔ 阅读台联结（本地导入 · 总结同步 · docKey） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };

console.log("=== verify-lumina-library-reader-link ===\n");

if (exists("src/core/store/local-import.ts")) {
  const s = read("src/core/store/local-import.ts");
  /sha256Hex/.test(s) && /paperIdFromContentHash/.test(s) ? ok("local-import 哈希身份") : bad("local-import 不完整");
} else bad("缺 local-import.ts");

if (exists("src/core/store/doc-migrate.ts")) {
  const s = read("src/core/store/doc-migrate.ts");
  /migrateDocKeys/.test(s) && /migrateReaderAnalysisKeys/.test(s) ? ok("doc-migrate 缓存合并") : bad("doc-migrate 不完整");
} else bad("缺 doc-migrate.ts");

if (exists("src/ui/reader-doc-key.js")) {
  /contentHash/.test(read("src/ui/reader-doc-key.js")) ? ok("渲染层 docKey 含 hash") : bad("reader-doc-key 缺 hash");
} else bad("缺 reader-doc-key.js");

if (exists("electron/paper-asset-ipc.ts")) {
  /importLocalPdfToLibrary/.test(read("electron/paper-asset-ipc.ts")) ? ok("importLocalPdfToLibrary") : bad("缺导入函数");
}

if (exists("src/ui/modules/Reader.jsx")) {
  const s = read("src/ui/modules/Reader.jsx");
  /加入文献/.test(s) && /onLibraryImport/.test(s) && /readerDocKeyCandidates/.test(s) ? ok("Reader 加入文献 + 多键缓存") : bad("Reader 未接工作集");
}

if (exists("src/ui/modules/ReadHub.jsx")) {
  const s = read("src/ui/modules/ReadHub.jsx");
  /onImportLocal/.test(s) && /contentHash/.test(s) && /＋文献/.test(s) ? ok("ReadHub 本地导入入口") : bad("ReadHub 未更新");
}

// 单元：哈希 paperId 稳定
try {
  const { sha256Hex, paperIdFromContentHash } = await import("../src/core/store/local-import.ts");
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const h = sha256Hex(bytes);
  const id1 = paperIdFromContentHash(h);
  const id2 = paperIdFromContentHash(h);
  id1 === id2 && id1.startsWith("import-") ? ok("哈希 paperId 稳定") : bad("哈希 paperId 不稳定");
} catch (e) {
  bad("local-import 运行时加载失败: " + (e && e.message));
}

console.log(`\n=== verify: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
