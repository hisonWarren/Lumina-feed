// 本地 PDF → 工作集导入（内容哈希身份 · 稳定 paperId）
import { createHash } from "node:crypto";
import path from "node:path";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 仅含安全字符，可落盘为 encodeURIComponent(paperId).pdf */
export function paperIdFromContentHash(hashHex: string): string {
  const h = String(hashHex || "").replace(/[^a-f0-9]/gi, "").slice(0, 40);
  if (!h) throw new Error("empty hash");
  return `import-${h}`;
}

export function titleFromFilename(name: string): string {
  const base = path.basename(String(name || "document.pdf"), ".pdf");
  const t = base.replace(/[_-]+/g, " ").trim();
  return t || "未命名 PDF";
}

export const IMPORT_PROVENANCE = "local_import";

export function importMapHashKey(hash: string): string {
  return `importmap:hash:${hash}`;
}

export function importMapPathKey(localPath: string): string {
  return `importmap:path:${localPath}`;
}
