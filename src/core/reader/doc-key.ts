// 阅读器 docKey：统一 paper / 内容哈希 / 本地路径 / 兜底指纹
import { normalizeLocalPath } from "./reading-history.ts";

export type ReaderSourceLike = {
  paperId?: string;
  contentHash?: string;
  localPath?: string;
  name?: string;
  data?: ArrayBuffer | Uint8Array | { byteLength?: number } | null;
};

export function readerDocKey(source: ReaderSourceLike | null | undefined): string {
  if (!source) return "";
  if (source.paperId) return `paper:${source.paperId}`;
  if (source.contentHash) return `hash:${source.contentHash}`;
  if (source.localPath) return `local:${normalizeLocalPath(source.localPath)}`;
  const len = source.data && typeof (source.data as ArrayBuffer).byteLength === "number"
    ? (source.data as ArrayBuffer).byteLength
    : 0;
  return `${source.name || "doc"}:${len}`;
}

/** 加载/迁移缓存时按优先级尝试的全部键（去重）。 */
export function readerDocKeyCandidates(source: ReaderSourceLike | null | undefined): string[] {
  if (!source) return [];
  const out: string[] = [];
  const push = (k: string) => { if (k && !out.includes(k)) out.push(k); };
  if (source.paperId) push(`paper:${source.paperId}`);
  if (source.contentHash) push(`hash:${source.contentHash}`);
  if (source.localPath) push(`local:${normalizeLocalPath(source.localPath)}`);
  push(readerDocKey(source));
  return out;
}

export function paperIdFromDocKey(docKey: string): string | null {
  if (!docKey || !docKey.startsWith("paper:")) return null;
  return docKey.slice(6) || null;
}
